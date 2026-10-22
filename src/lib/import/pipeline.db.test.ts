/**
 * Import pipeline behavior against a real database: server-side row limits,
 * managers by name, file-wide rules across chunks and "all or nothing" in
 * client-repeatable steps.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as finalizeRoute } from "@/app/api/import/personas/[jobId]/finalize/route";
import { POST as appendRowsRoute } from "@/app/api/import/personas/[jobId]/rows/route";
import { importJobs, importRows, people } from "@/lib/db/schema";
import { curpCheckDigit } from "@/lib/people/identity";
import { ownerDb, seedTenant, type Tenant } from "@/test/idor/fixtures";
import { actAs } from "@/test/idor/session-state";

import { applyJobStep } from "./apply";
import { IMPORT_LIMITS } from "./format";
import {
  ImportRowLimitError,
  appendImportRows,
  createImportJob,
  finalizeImportUpload,
} from "./jobs";
import {
  validateContratosChunk,
  validateJobStep,
  validatePersonasChunk,
} from "./validate";

let t: Tenant;

const curp = (base17: string) => `${base17}${curpCheckDigit(base17)}`;
const CURP_JEFA = curp("MEOL880514MDFNRR0");
const CURP_OTRA = curp("SAVR910302HJCLGC0");

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
const post = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

type Cells = Record<string, string | number | null>;

/** A job in validation with these rows, as the browser would leave it. */
const stage = async (
  sheets: Partial<Record<"personas" | "horarios" | "contratos", Cells[]>>,
  options: Record<string, unknown> = {},
) => {
  const total = Object.values(sheets).reduce((n, r) => n + r.length, 0);
  const job = await createImportJob(
    t.companyId,
    {
      fileName: "prueba.xlsx",
      fileHash: "a".repeat(64),
      fileSizeBytes: 1,
      totalRows: total,
    },
    t.admin.id,
  );

  for (const [sheet, rows] of Object.entries(sheets)) {
    await appendImportRows(t.companyId, job.id, {
      sheet: sheet as "personas",
      rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
    });
  }

  await finalizeImportUpload(t.companyId, job.id, total);
  await ownerDb
    .update(importJobs)
    .set({ options })
    .where(eq(importJobs.id, job.id));

  return job;
};

const validateAll = async (jobId: string) => {
  let step;

  do {
    step = await validateJobStep(t.companyId, jobId);
  } while (!step.done);

  return step.counts;
};

const rowsOf = (jobId: string, sheet = "personas") =>
  ownerDb
    .select()
    .from(importRows)
    .where(and(eq(importRows.jobId, jobId), eq(importRows.sheet, sheet)))
    .orderBy(asc(importRows.rowNumber));

beforeAll(async () => {
  t = await seedTenant("P");
});

describe("server-side row limits", () => {
  it("rejects a chunk that takes a sheet past its limit, counting stored rows", async () => {
    const job = await createImportJob(
      t.companyId,
      // The browser claims a tiny file; the server counts what it stores.
      {
        fileName: "x.xlsx",
        fileHash: "b".repeat(64),
        fileSizeBytes: 1,
        totalRows: 1,
      },
      t.admin.id,
    );
    const max = IMPORT_LIMITS.maxRowsPerSheet.personas;

    await ownerDb.insert(importRows).values(
      Array.from({ length: max }, (_, i) => ({
        companyId: t.companyId,
        jobId: job.id,
        sheet: "personas",
        rowNumber: i + 2,
        raw: { nombres: `P${i}`, apellidoPaterno: "X" },
      })),
    );

    // Re-sending stored rows replaces them: still within the limit.
    await expect(
      appendImportRows(t.companyId, job.id, {
        sheet: "personas",
        rows: [{ rowNumber: 2, cells: { nombres: "P0" } }],
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendImportRows(t.companyId, job.id, {
        sheet: "personas",
        rows: [{ rowNumber: max + 2, cells: { nombres: "Extra" } }],
      }),
    ).rejects.toBeInstanceOf(ImportRowLimitError);

    actAs(t.admin);
    const response = await appendRowsRoute(
      post({
        sheet: "personas",
        rows: [{ rowNumber: max + 2, cells: { nombres: "Extra" } }],
      }),
      params(job.id),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("5,000 personas");

    // Horarios has its own limit, unaffected by Personas.
    await expect(
      appendImportRows(t.companyId, job.id, {
        sheet: "horarios",
        rows: [{ rowNumber: 2, cells: { curp: CURP_JEFA } }],
      }),
    ).resolves.toBeUndefined();
  });

  it("finalize refuses a sheet over its limit even if the browser announced fewer rows", async () => {
    const job = await createImportJob(
      t.companyId,
      {
        fileName: "x.xlsx",
        fileHash: "c".repeat(64),
        fileSizeBytes: 1,
        totalRows: 1,
      },
      t.admin.id,
    );

    // Rows stored behind the limit check (e.g. two chunks racing).
    await ownerDb.insert(importRows).values(
      Array.from(
        { length: IMPORT_LIMITS.maxRowsPerSheet.horarios + 1 },
        (_, i) => ({
          companyId: t.companyId,
          jobId: job.id,
          sheet: "horarios",
          rowNumber: i + 2,
          raw: { curp: CURP_JEFA },
        }),
      ),
    );

    actAs(t.admin);
    const response = await finalizeRoute(post({}), params(job.id));

    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("Horarios");
    expect(
      (
        await ownerDb.select().from(importJobs).where(eq(importJobs.id, job.id))
      )[0].status,
    ).toBe("uploading");
  });

  it("rejects row numbers out of range and repeated in one chunk", async () => {
    const job = await createImportJob(
      t.companyId,
      {
        fileName: "x.xlsx",
        fileHash: "d".repeat(64),
        fileSizeBytes: 1,
        totalRows: 1,
      },
      t.admin.id,
    );

    actAs(t.admin);

    for (const rows of [
      [{ rowNumber: IMPORT_LIMITS.maxRowNumber + 1, cells: { nombres: "X" } }],
      [{ rowNumber: 1, cells: { nombres: "X" } }],
      [
        { rowNumber: 3, cells: { nombres: "X" } },
        { rowNumber: 3, cells: { nombres: "Y" } },
      ],
    ]) {
      const response = await appendRowsRoute(
        post({ sheet: "personas", rows }),
        params(job.id),
      );

      expect(response.status).toBe(400);
    }

    expect(
      await ownerDb
        .select()
        .from(importRows)
        .where(eq(importRows.jobId, job.id)),
    ).toEqual([]);
  });
});

describe("jefe directo by name", () => {
  beforeAll(async () => {
    await ownerDb.insert(people).values([
      {
        companyId: t.companyId,
        nombres: "Olga",
        apellidoPaterno: "Méndez",
        apellidoMaterno: "Ruiz",
        curp: CURP_JEFA,
      },
      // Two people share this name.
      { companyId: t.companyId, nombres: "Pedro", apellidoPaterno: "Gil" },
      {
        companyId: t.companyId,
        nombres: "Pedro",
        apellidoPaterno: "Gil",
        curp: CURP_OTRA,
      },
      // Deleted people never match.
      {
        companyId: t.companyId,
        nombres: "Borrada",
        apellidoPaterno: "Sola",
        deletedAt: new Date(),
      },
    ]);
  });

  it("resolves a unique name in the file or in Workia, and explains the rest", async () => {
    const job = await stage({
      personas: [
        { nombres: "Iván", apellidoPaterno: "Ríos" },
        { nombres: "Ema", apellidoPaterno: "Paz", jefeDirecto: "ivan rios" },
        {
          nombres: "Leo",
          apellidoPaterno: "Mar",
          jefeDirecto: "Olga Méndez Ruiz",
        },
        { nombres: "Uma", apellidoPaterno: "Sol", jefeDirecto: "Pedro Gil" },
        { nombres: "Eva", apellidoPaterno: "Luz", jefeDirecto: "Nadie Nunca" },
        {
          nombres: "Ada",
          apellidoPaterno: "Mora",
          jefeDirecto: "Borrada Sola",
        },
        { nombres: "Gil", apellidoPaterno: "Ney", jefeDirecto: CURP_JEFA },
      ],
    });

    await validateAll(job.id);

    const rows = await rowsOf(job.id);
    const byRow = new Map(rows.map((row) => [row.rowNumber, row]));
    const [olga] = await ownerDb
      .select({ id: people.id })
      .from(people)
      .where(eq(people.curp, CURP_JEFA));

    expect(byRow.get(3)?.normalized).toMatchObject({
      managerRef: { type: "row", rowNumber: 2 },
    });
    expect(byRow.get(4)?.normalized).toMatchObject({
      managerRef: { type: "person", id: olga.id },
    });
    expect(byRow.get(8)?.normalized).toMatchObject({
      managerRef: { type: "person", id: olga.id },
    });

    const ambiguous = byRow.get(5)!;

    expect(ambiguous.action).toBe("error");
    expect(ambiguous.errors?.[0].message).toContain("CURP o el ID Workia");
    // Never reveals who the other people are.
    expect(JSON.stringify(ambiguous.errors)).not.toContain(CURP_OTRA);
    expect(idsInText(JSON.stringify(ambiguous.errors))).toEqual([]);

    for (const row of [6, 7]) {
      expect(byRow.get(row)?.action).toBe("error");
      expect(byRow.get(row)?.errors?.[0].message).toContain(
        "nombre completo como está en Workia, su CURP o su ID Workia",
      );
    }
  });
});

const idsInText = (text: string) =>
  text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ??
  [];

describe("file-wide rules across chunks", () => {
  it("flags a repeated CURP in a later chunk, written differently", async () => {
    const job = await stage({
      personas: [
        {
          nombres: "Uno",
          apellidoPaterno: "A",
          curp: curp("UXOA010101HDFNNN0"),
        },
        { nombres: "Dos", apellidoPaterno: "B" },
        { nombres: "Tres", apellidoPaterno: "C" },
        {
          nombres: "Cuatro",
          apellidoPaterno: "D",
          curp: ` ${curp("UXOA010101HDFNNN0").toLowerCase()} `,
        },
      ],
    });

    while (
      (await validatePersonasChunk(t.companyId, job.id, 1)).processed > 0
    ) {
      // One row per chunk: the repeat is three chunks after the original.
    }

    const rows = await rowsOf(job.id);

    expect(rows.map((row) => row.action)).toEqual([
      "create",
      "create",
      "create",
      "error",
    ]);
    expect(rows[3].errors?.[0].message).toContain("fila 2");
  });

  it("applies contract rules to rows of the same person in other chunks", async () => {
    const job = await stage({
      contratos: [
        {
          curp: t.person.curp,
          tipo: "Indeterminado",
          fechaInicio: "2019-01-01",
          estatus: "Renovado",
        },
        { curp: CURP_OTRA, tipo: "Indeterminado", fechaInicio: "2020-01-01" },
        {
          curp: ` ${t.person.curp!.toLowerCase()}`,
          tipo: "Indeterminado",
          fechaInicio: "2019-01-01",
          estatus: "Renovado",
        },
      ],
    });

    await validatePersonasChunk(t.companyId, job.id);

    while (
      (await validateContratosChunk(t.companyId, job.id, 1)).processed > 0
    ) {
      // One row per chunk.
    }

    const rows = await rowsOf(job.id, "contratos");

    expect(rows[2].action).toBe("error");
    expect(rows[2].errors?.[0].message).toContain("fila 2");
  });
});

describe("all or nothing", () => {
  it("validates again in client-repeatable steps before applying", async () => {
    const job = await stage(
      { personas: [{ nombres: "Todo", apellidoPaterno: "Nada" }] },
      { mode: "all_or_nothing" },
    );

    await validateAll(job.id);

    const first = await applyJobStep(t.companyId, job.id);

    expect(first).toMatchObject({ phase: "validating", done: false });

    let step = first;
    const phases: string[] = [first.phase];

    while (!step.done) {
      step = await applyJobStep(t.companyId, job.id);
      phases.push(step.phase);
    }

    expect(phases[0]).toBe("validating");
    expect(phases).toContain("personas");
    expect(
      (
        await ownerDb.select().from(importJobs).where(eq(importJobs.id, job.id))
      )[0],
    ).toMatchObject({ status: "applied" });
  });

  it("refuses to apply when the fresh validation finds errors", async () => {
    const job = await stage(
      {
        personas: [
          { nombres: "Bien", apellidoPaterno: "Uno" },
          { nombres: "Mal", apellidoPaterno: "Dos", curp: "MALA" },
        ],
      },
      { mode: "all_or_nothing" },
    );

    await validateAll(job.id);

    let error: unknown = null;

    for (let i = 0; i < 10 && !error; i += 1) {
      error = await applyJobStep(t.companyId, job.id).then(
        () => null,
        (cause: unknown) => cause,
      );
    }

    expect(error).toMatchObject({ code: "has_errors" });

    const [after] = await ownerDb
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job.id));

    expect(after.status).toBe("in_review");
    expect(after.options.revalidating).toBeUndefined();
    expect(
      await ownerDb
        .select()
        .from(people)
        .where(
          and(eq(people.companyId, t.companyId), eq(people.nombres, "Bien")),
        ),
    ).toEqual([]);
  });
});
