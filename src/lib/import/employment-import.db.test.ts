/**
 * Baja columns of the Personas import (Iniciativa 1 + 2) against a real
 * database: a baja with its data closes the open period through the
 * employment domain, a baja without data stays «sin fecha» with a warning,
 * a row corrects the last baja of someone de baja, «Fecha de antigüedad»
 * becomes the recognized seniority, undo puts periods and contracts back,
 * re-importing an export changes nothing, and a motivo never resolves
 * across companies.
 */
import { PassThrough } from "node:stream";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withTransaction } from "@/lib/db";
import {
  auditEvents,
  contracts,
  employmentPeriods,
  importRows,
  people,
  terminationReasons,
} from "@/lib/db/schema";
import { createPerson } from "@/lib/people";
import {
  EmploymentError,
  correctTermination,
  getEmploymentSummary,
  recognizeSeniority,
  recordTermination,
  terminatePerson,
  updateFiniquito,
} from "@/lib/people/employment";
import type { PersonFormValues } from "@/lib/people/schema";
import {
  createTerminationReason,
  listTerminationReasons,
  updateTerminationReason,
} from "@/lib/termination-reasons";
import { ownerDb, seedTenant, type Tenant } from "@/test/idor/fixtures";

import { applyJobStep } from "./apply";
import { parseSheet } from "./client";
import { parseCsv } from "./csv";
import { writeExport } from "./export";
import {
  appendImportRows,
  createImportJob,
  finalizeImportUpload,
} from "./jobs";
import { previewUndo, undoJobStep } from "./undo";
import { validateJobStep } from "./validate";

let a: Tenant;
let b: Tenant;
let reasons: Awaited<ReturnType<typeof listTerminationReasons>>;
let onlyInB: typeof terminationReasons.$inferSelect;

type Cells = Record<string, string | number | null>;

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Baja",
  apellidoPaterno: "Importada",
  apellidoMaterno: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  fechaIngreso: "2020-03-01",
  areaId: "",
  positionId: "",
  managerId: "",
  siteId: "",
  rfc: "",
  curp: "",
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

const newPerson = (nombres: string, apellidoPaterno = "Importada") =>
  createPerson(
    a.companyId,
    personForm({ nombres, apellidoPaterno }),
    a.admin.id,
  );

/** The identifying cells of an existing person, as an export writes them. */
const rowOf = (person: typeof people.$inferSelect, cells: Cells = {}) => ({
  idWorkia: person.id,
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  ...cells,
});

const stage = async (rows: Cells[], companyId = a.companyId) => {
  const job = await createImportJob(
    companyId,
    {
      fileName: "bajas.xlsx",
      fileHash: "e".repeat(64),
      fileSizeBytes: 1,
      totalRows: rows.length,
    },
    a.admin.id,
  );

  await appendImportRows(companyId, job.id, {
    sheet: "personas",
    rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
  });
  await finalizeImportUpload(companyId, job.id, rows.length);

  return job;
};

const validateAll = async (jobId: string, companyId = a.companyId) => {
  let step;

  do {
    step = await validateJobStep(companyId, jobId);
  } while (!step.done);

  return ownerDb
    .select()
    .from(importRows)
    .where(eq(importRows.jobId, jobId))
    .orderBy(importRows.rowNumber);
};

const applyAll = async (jobId: string) => {
  let step;

  do {
    step = await applyJobStep(a.companyId, jobId);
  } while (!step.done);
};

const undoAll = async (jobId: string) => {
  let step;

  do {
    step = await undoJobStep(a.companyId, jobId);
  } while (!step.done);
};

const periodsOf = (personId: string) =>
  ownerDb
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.personId, personId))
    .orderBy(employmentPeriods.createdAt);

const personRow = async (id: string) =>
  (await ownerDb.select().from(people).where(eq(people.id, id)))[0];

const bajaCells = (motivo: string, extra: Cells = {}): Cells => ({
  estatus: "Baja",
  fechaBaja: "2025-11-28",
  tipoBaja: "Despido",
  motivoBaja: motivo,
  comentarioBaja: "Cierre de sucursal",
  recontratable: "No",
  ...extra,
});

beforeAll(async () => {
  a = await seedTenant("BA");
  b = await seedTenant("BB");
  reasons = await listTerminationReasons(a.companyId, { activeOnly: true });
  onlyInB = await createTerminationReason(
    b.companyId,
    { name: "Motivo solo de B", active: true },
    b.admin.id,
  );
});

describe("a baja with its data", () => {
  it("closes the open period through the domain, ends the vigente contract, and undo restores both", async () => {
    const person = await newPerson("Cierra");
    const [contract] = await ownerDb
      .insert(contracts)
      .values({
        companyId: a.companyId,
        personId: person.id,
        type: "indeterminado",
        startDate: "2020-03-01",
        generatedText: "texto",
      })
      .returning();
    const [before] = await periodsOf(person.id);
    const job = await stage([rowOf(person, bajaCells(reasons[0].name))]);
    const [row] = await validateAll(job.id);

    expect(row.action).toBe("update");
    expect(row.diff).toMatchObject({
      status: ["activa", "baja"],
      fechaBaja: [null, "2025-11-28"],
      tipoBaja: [null, "Despido"],
      motivoBaja: [null, reasons[0].name],
      recontratable: [null, "No"],
    });

    await applyAll(job.id);

    expect((await personRow(person.id)).status).toBe("baja");
    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        id: before.id,
        fechaBaja: "2025-11-28",
        tipoBaja: "despido",
        motivoBajaId: reasons[0].id,
        comentarioBaja: "Cierre de sucursal",
        recontratable: false,
        bajaSinFecha: false,
        requiereRevision: false,
      }),
    ]);
    expect(
      (
        await ownerDb
          .select()
          .from(contracts)
          .where(eq(contracts.id, contract.id))
      )[0],
    ).toMatchObject({ status: "terminado", endDate: "2025-11-28" });

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceId, person.id),
          eq(auditEvents.action, "baja"),
        ),
      );

    expect(events).toEqual([expect.objectContaining({ source: "import" })]);

    await undoAll(job.id);

    expect((await personRow(person.id)).status).toBe("activa");
    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        id: before.id,
        fechaBaja: null,
        tipoBaja: null,
        motivoBajaId: null,
        recontratable: null,
        bajaSinFecha: false,
      }),
    ]);
    expect(
      (
        await ownerDb
          .select()
          .from(contracts)
          .where(eq(contracts.id, contract.id))
      )[0],
    ).toMatchObject({ status: "vigente", endDate: null });
  });

  it("creates a person de baja with the baja", async () => {
    const job = await stage([
      {
        nombres: "Alta",
        apellidoPaterno: "YaDeBaja",
        fechaIngreso: "2021-01-04",
        ...bajaCells(reasons[0].name, { recontratable: "Sí" }),
      },
    ]);
    const [row] = await validateAll(job.id);

    expect(row.action).toBe("create");
    expect(row.errors ?? []).toEqual([]);

    await applyAll(job.id);

    const [created] = await ownerDb
      .select()
      .from(people)
      .where(
        and(
          eq(people.companyId, a.companyId),
          eq(people.apellidoPaterno, "YaDeBaja"),
        ),
      );

    expect(created.status).toBe("baja");
    expect(await periodsOf(created.id)).toEqual([
      expect.objectContaining({
        fechaIngreso: "2021-01-04",
        fechaBaja: "2025-11-28",
        recontratable: true,
        bajaSinFecha: false,
      }),
    ]);
  });

  it("explains a baja before the ingreso, missing columns and an unknown motivo", async () => {
    const rows = await validateAll(
      (
        await stage([
          rowOf(
            await newPerson("Temprana"),
            bajaCells(reasons[0].name, { fechaBaja: "2019-12-31" }),
          ),
          rowOf(await newPerson("Incompleta"), {
            estatus: "Baja",
            fechaBaja: "2025-11-28",
          }),
          rowOf(
            await newPerson("Inventada"),
            bajaCells("Motivo que no existe"),
          ),
        ])
      ).id,
    );

    expect(rows.map((row) => row.action)).toEqual(["error", "error", "error"]);
    expect(rows[0].errors?.[0]).toMatchObject({ field: "fechaBaja" });
    expect(rows[0].errors?.[0].message).toContain("01/03/2020");
    expect(rows[1].errors?.[0].message).toContain(
      "falta Tipo de baja, Motivo de baja, Recontratable",
    );
    expect(rows[2].errors?.[0]).toMatchObject({ field: "motivoBaja" });
    expect(rows[2].errors?.[0].message).toContain("Catálogo > Motivos de baja");
  });
});

describe("a baja without its data", () => {
  it("keeps the «sin fecha» period for review with a warning, and undo reopens it", async () => {
    const person = await newPerson("SinFecha");
    const job = await stage([rowOf(person, { estatus: "Baja" })]);
    const [row] = await validateAll(job.id);

    expect(row.action).toBe("update");
    expect(row.errors).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("«sin fecha»"),
      }),
    ]);

    await applyAll(job.id);

    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        fechaBaja: null,
        bajaSinFecha: true,
        requiereRevision: true,
      }),
    ]);

    await undoAll(job.id);

    expect((await personRow(person.id)).status).toBe("activa");
    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({ bajaSinFecha: false, requiereRevision: false }),
    ]);
  });

  it("an import that reactivates someone de baja opens a period that undo removes", async () => {
    const person = await newPerson("Vuelve");

    await terminatePerson(
      a.companyId,
      person.id,
      {
        fechaBaja: "2024-05-31",
        tipoBaja: "voluntaria",
        motivoBajaId: reasons[0].id,
        recontratable: true,
      },
      a.admin.id,
    );

    const job = await stage([rowOf(person, { estatus: "Activa" })]);

    await validateAll(job.id);
    await applyAll(job.id);

    expect(await periodsOf(person.id)).toHaveLength(2);

    await undoAll(job.id);

    expect((await personRow(person.id)).status).toBe("baja");
    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({ fechaBaja: "2024-05-31" }),
    ]);
  });
});

describe("someone already de baja", () => {
  it("corrects the last period; undo restores it", async () => {
    const person = await newPerson("Corrige");

    await terminatePerson(
      a.companyId,
      person.id,
      {
        fechaBaja: "2024-05-31",
        tipoBaja: "voluntaria",
        motivoBajaId: reasons[0].id,
        comentario: "Primera versión",
        recontratable: true,
      },
      a.admin.id,
    );

    const job = await stage([
      rowOf(person, {
        estatus: "Baja",
        motivoBaja: reasons[1].name,
        recontratable: "No",
      }),
    ]);
    const [row] = await validateAll(job.id);

    expect(row.action).toBe("update");
    expect(row.diff).toEqual({
      motivoBaja: [reasons[0].name, reasons[1].name],
      recontratable: ["Sí", "No"],
    });

    await applyAll(job.id);

    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        fechaBaja: "2024-05-31",
        tipoBaja: "voluntaria",
        motivoBajaId: reasons[1].id,
        comentarioBaja: "Primera versión",
        recontratable: false,
      }),
    ]);

    await undoAll(job.id);

    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        motivoBajaId: reasons[0].id,
        recontratable: true,
      }),
    ]);
  });

  it("does not undo over a baja edited after the import", async () => {
    const person = await newPerson("Editada");
    const job = await stage([rowOf(person, bajaCells(reasons[0].name))]);

    await validateAll(job.id);
    await applyAll(job.id);
    await updateFiniquito(
      a.companyId,
      person.id,
      { estado: "pagado", fecha: "2025-12-05" },
      a.admin.id,
    );

    const preview = await previewUndo(a.companyId, job.id);

    expect(preview.allowed).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.reason)).toContain(
      "Su periodo laboral o su baja cambió después de la importación.",
    );
  });
});

describe("Fecha de antigüedad", () => {
  it("is the recognized seniority of the open period when it differs from the ingreso; undo restores it", async () => {
    const person = await newPerson("Antigua");
    const same = await validateAll(
      (await stage([rowOf(person, { fechaAntiguedad: "2020-03-01" })])).id,
    );

    expect(same[0].action).toBe("unchanged");

    const job = await stage([rowOf(person, { fechaAntiguedad: "2015-06-01" })]);
    const [row] = await validateAll(job.id);

    expect(row.diff).toEqual({ fechaAntiguedad: ["2020-03-01", "2015-06-01"] });

    await applyAll(job.id);

    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        reconoceAntiguedad: true,
        fechaAntiguedadReconocida: "2015-06-01",
        fechaAntiguedad: "2015-06-01",
      }),
    ]);
    expect(
      (await getEmploymentSummary(a.companyId, person.id))?.fechaAntiguedad,
    ).toBe("2015-06-01");

    await undoAll(job.id);

    expect(await periodsOf(person.id)).toEqual([
      expect.objectContaining({
        reconoceAntiguedad: false,
        fechaAntiguedadReconocida: null,
        fechaAntiguedad: "2020-03-01",
      }),
    ]);
  });
});

describe("round trip", () => {
  it("re-importing the export is all «sin cambios», bajas and antigüedad included", async () => {
    const lastName = "Redondo";
    await newPerson("Activa", lastName);
    const reconocida = await newPerson("Reconocida", lastName);
    const conBaja = await newPerson("ConBaja", lastName);
    const sinFecha = await newPerson("SinFecha", lastName);
    const inactivo = await newPerson("Inactivo", lastName);
    const [retired] = await ownerDb
      .insert(terminationReasons)
      .values({ companyId: a.companyId, name: "Motivo retirado" })
      .returning();

    await withTransaction(
      (tx) => recognizeSeniority(tx, a.companyId, reconocida.id, "2016-01-11"),
      a.companyId,
    );

    for (const [person, motivoBajaId] of [
      [conBaja, reasons[0].id],
      [inactivo, retired.id],
    ] as const) {
      await terminatePerson(
        a.companyId,
        person.id,
        {
          fechaBaja: "2025-01-31",
          tipoBaja: "termino_contrato",
          motivoBajaId,
          comentario: "Fin, de obra",
          recontratable: true,
          finiquito: { estado: "pagado", monto: 9876.5 },
        },
        a.admin.id,
      );
    }

    // Deactivated after the baja: the exported name still re-imports.
    await updateTerminationReason(
      a.companyId,
      retired.id,
      { name: retired.name, active: false },
      a.admin.id,
    );

    const sinFechaJob = await stage([rowOf(sinFecha, { estatus: "Baja" })]);

    await validateAll(sinFechaJob.id);
    await applyAll(sinFechaJob.id);

    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    const written = await writeExport(stream, {
      companyId: a.companyId,
      format: "csv",
      filters: { query: lastName },
      includeContracts: false,
    });
    const csv = Buffer.concat(chunks).toString("utf8");

    expect(written).toBe(5);
    expect(csv).toContain("Término de contrato");
    expect(csv).toContain("Motivo retirado");
    expect(csv).toContain("11/01/2016");
    // The finiquito amount is not an import column.
    expect(csv).not.toContain("9876");

    const parsed = parseSheet("personas", {
      name: "Personas",
      data: parseCsv(csv.replace(/^﻿/, "")),
    });

    expect(parsed.mapping.unknown).toEqual([]);

    const rows = await validateAll(
      (await stage(parsed.rows.map((row) => row.cells as Cells))).id,
    );

    expect(rows.map((row) => [row.action, row.errors ?? []])).toEqual(
      rows.map(() => ["unchanged", []]),
    );
  });
});

describe("motivos and periods stay inside the company", () => {
  it("a motivo of another company never resolves, by name or by id", async () => {
    const person = await newPerson("OtraEmpresa");
    const rows = await validateAll(
      (
        await stage([
          rowOf(person, bajaCells(onlyInB.name)),
          rowOf(await newPerson("OtraEmpresaId"), bajaCells(onlyInB.id)),
        ])
      ).id,
    );

    for (const row of rows) {
      expect(row.action).toBe("error");
      expect(row.errors?.[0]).toMatchObject({ field: "motivoBaja" });
      expect(JSON.stringify(row.normalized)).not.toContain(onlyInB.id);
    }

    // The domain helpers the import calls refuse it too.
    await expect(
      withTransaction(
        (tx) =>
          recordTermination(tx, a.companyId, person.id, {
            fechaBaja: "2025-11-28",
            tipoBaja: "otra",
            motivoBajaId: onlyInB.id,
            recontratable: true,
          }),
        a.companyId,
      ),
    ).rejects.toBeInstanceOf(EmploymentError);
    expect((await personRow(person.id)).status).toBe("activa");
  });

  it("the domain helpers do not reach another company's people", async () => {
    const values = {
      fechaBaja: "2025-11-28",
      tipoBaja: "otra" as const,
      motivoBajaId: onlyInB.id,
      recontratable: true,
    };

    await withTransaction(async (tx) => {
      expect(
        await recordTermination(tx, b.companyId, b.person.id, values),
      ).not.toBeNull();
    }, b.companyId);

    // Company A asks for B's person: nothing found, nothing written.
    await withTransaction(async (tx) => {
      expect(
        await recordTermination(tx, a.companyId, b.person.id, values),
      ).toBeNull();
      expect(
        await correctTermination(tx, a.companyId, b.person.id, values),
      ).toBeNull();
      await expect(
        recognizeSeniority(tx, a.companyId, b.person.id, "2010-01-01"),
      ).rejects.toBeInstanceOf(EmploymentError);
    }, a.companyId);

    // An import in A that names B's person by ID Workia does not match it.
    const [row] = await validateAll(
      (
        await stage([
          rowOf(
            b.person as typeof people.$inferSelect,
            bajaCells(reasons[0].name),
          ),
        ])
      ).id,
    );

    expect(row.action).toBe("error");
    expect(row.errors?.[0]).toMatchObject({ field: "idWorkia" });
    expect(await periodsOf(b.person.id)).toEqual([
      expect.objectContaining({
        motivoBajaId: onlyInB.id,
        recontratable: true,
      }),
    ]);
  });
});
