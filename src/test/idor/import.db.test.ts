/**
 * Cross-company isolation for import and export of people (WRK-I4-11): the
 * API routes, the import pipeline and the export. Test titles are the surface
 * ids of docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as createJobRoute } from "@/app/api/import/personas/route";
import { GET as jobRoute } from "@/app/api/import/personas/[jobId]/route";
import {
  DELETE as pauseRoute,
  POST as applyRoute,
} from "@/app/api/import/personas/[jobId]/apply/route";
import { GET as errorsRoute } from "@/app/api/import/personas/[jobId]/errors/route";
import { POST as finalizeRoute } from "@/app/api/import/personas/[jobId]/finalize/route";
import {
  GET as listRowsRoute,
  POST as appendRowsRoute,
} from "@/app/api/import/personas/[jobId]/rows/route";
import {
  GET as previewUndoRoute,
  POST as undoRoute,
} from "@/app/api/import/personas/[jobId]/undo/route";
import {
  POST as validateRoute,
  PUT as revalidateRoute,
} from "@/app/api/import/personas/[jobId]/validate/route";
import { GET as exportRoute } from "@/app/app/personas/exportar/route";
import { GET as templateRoute } from "@/app/app/personas/plantilla/route";
import { importRows, people } from "@/lib/db/schema";
import { applyJobStep, pauseApply } from "@/lib/import/apply";
import { buildErrorReport, loadErrorRows } from "@/lib/import/error-report";
import {
  appendImportRows,
  countStagedRows,
  createImportJob,
  finalizeImportUpload,
  findJobsByHash,
  getImportJob,
  listImportJobs,
  listImportRows,
} from "@/lib/import/jobs";
import { loadUploadingJob } from "@/lib/import/route-helpers";
import { previewUndo, undoJobStep } from "@/lib/import/undo";
import {
  countJobRows,
  loadCatalogIndex,
  loadLookups,
  resolveManagers,
  restartValidation,
  validateContratosChunk,
  validateHorariosChunk,
  validateJobStep,
  validatePersonasChunk,
} from "@/lib/import/validate";
import { curpCheckDigit } from "@/lib/people/identity";

import {
  idsIn,
  ownerDb,
  seedTenant,
  snapshotTenant,
  tenantIds,
  type Tenant,
} from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;

const noLeak = (value: unknown) => {
  const leaked = idsIn(value).filter((id) => tenantIds(a).has(id));
  expect(leaked, "ids of company A in company B's result").toEqual([]);
};

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
const request = (body?: unknown, url = "http://test/api") =>
  new Request(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const validCurp = (base17: string) => `${base17}${curpCheckDigit(base17)}`;

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("import API routes answer 404 for another company's job", () => {
  it.each([
    [
      "route:GET /api/import/personas/[jobId]",
      () => jobRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:POST /api/import/personas/[jobId]/apply",
      () => applyRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:DELETE /api/import/personas/[jobId]/apply",
      () => pauseRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:GET /api/import/personas/[jobId]/errors",
      () => errorsRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:POST /api/import/personas/[jobId]/finalize",
      () => finalizeRoute(request(), params(a.uploadingJob.id)),
    ],
    [
      "route:POST /api/import/personas/[jobId]/rows",
      () =>
        appendRowsRoute(
          request({
            sheet: "personas",
            rows: [{ rowNumber: 2, cells: { nombres: "X" } }],
          }),
          params(a.uploadingJob.id),
        ),
    ],
    [
      "route:GET /api/import/personas/[jobId]/rows",
      () =>
        listRowsRoute(
          request(undefined, "http://test/api?page=1"),
          params(a.reviewJob.id),
        ),
    ],
    [
      "route:GET /api/import/personas/[jobId]/undo",
      () => previewUndoRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:POST /api/import/personas/[jobId]/undo",
      () => undoRoute(request(), params(a.reviewJob.id)),
    ],
    [
      "route:POST /api/import/personas/[jobId]/validate",
      () => validateRoute(request(), params(a.reviewJob.id)),
    ],
  ])("%s", async (_surface, call) => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const response = await call();
    expect(response.status).toBe(404);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("route:PUT /api/import/personas/[jobId]/validate", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const response = await revalidateRoute(
      request({ mode: "valid_only" }),
      params(a.reviewJob.id),
    );
    expect(response.status).toBe(409);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("route:POST /api/import/personas", async () => {
    actAs(b.admin);
    // Same file hash as A's job: not reported as a re-import, the job is B's.
    const response = await createJobRoute(
      request({
        fileName: "p.xlsx",
        fileHash: a.reviewJob.fileHash,
        fileSizeBytes: 10,
        totalRows: 1,
      }),
    );
    const body = await response.json();
    expect(body.previous).toEqual([]);
    expect((await getImportJob(b.companyId, body.jobId))?.companyId).toBe(
      b.companyId,
    );
  });

  it.each([
    [
      "rbac:route:POST /api/import/personas",
      () =>
        createJobRoute(
          request({
            fileName: "p.xlsx",
            fileHash: "h",
            fileSizeBytes: 1,
            totalRows: 1,
          }),
        ),
    ],
    [
      "rbac:route:GET /api/import/personas/[jobId]",
      () => jobRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:POST /api/import/personas/[jobId]/apply",
      () => applyRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:DELETE /api/import/personas/[jobId]/apply",
      () => pauseRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:GET /api/import/personas/[jobId]/errors",
      () => errorsRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:POST /api/import/personas/[jobId]/finalize",
      () => finalizeRoute(request(), params(b.uploadingJob.id)),
    ],
    [
      "rbac:route:POST /api/import/personas/[jobId]/rows",
      () =>
        appendRowsRoute(
          request({ sheet: "personas", rows: [] }),
          params(b.uploadingJob.id),
        ),
    ],
    [
      "rbac:route:GET /api/import/personas/[jobId]/rows",
      () => listRowsRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:GET /api/import/personas/[jobId]/undo",
      () => previewUndoRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:POST /api/import/personas/[jobId]/undo",
      () => undoRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:POST /api/import/personas/[jobId]/validate",
      () => validateRoute(request(), params(b.reviewJob.id)),
    ],
    [
      "rbac:route:PUT /api/import/personas/[jobId]/validate",
      () => revalidateRoute(request({}), params(b.reviewJob.id)),
    ],
  ])("%s", async (_surface, call) => {
    actAs(b.viewer);
    const before = await snapshotTenant(b);
    expect((await call()).status).toBe(403);
    expect(await snapshotTenant(b)).toEqual(before);
  });
});

describe("export and template only carry the active company", () => {
  it("route:GET /app/personas/exportar", async () => {
    actAs(b.admin);
    const response = await exportRoute(
      new Request("http://test/app/personas/exportar?format=csv"),
    );
    const text = await response.text();
    expect(text).toContain(b.person.nombres);
    expect(text).not.toContain(a.person.nombres);
    expect(response.headers.get("Content-Disposition")).toContain(
      b.company.slug,
    );
  });

  it("route:GET /app/personas/plantilla", async () => {
    actAs(b.admin);
    const response = await templateRoute();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const cells: string[] = [];
    workbook.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => cells.push(String(cell.value))),
      ),
    );
    expect(cells).toContain(b.area.name);
    expect(cells).not.toContain(a.area.name);
  });

  it("rbac:route:GET /app/personas/exportar", async () => {
    actAs(b.viewer);
    expect(
      (await exportRoute(new Request("http://test/app/personas/exportar")))
        .status,
    ).toBe(403);
  });

  it("rbac:route:GET /app/personas/plantilla", async () => {
    actAs(b.viewer);
    expect((await templateRoute()).status).toBe(403);
  });
});

describe("import pipeline functions stay inside the company", () => {
  it("lib:import/jobs/findJobsByHash", async () => {
    expect(await findJobsByHash(b.companyId, a.reviewJob.fileHash)).toEqual([]);
  });

  it("lib:import/jobs/createImportJob", async () => {
    const job = await createImportJob(
      b.companyId,
      { fileName: "x.xlsx", fileHash: "x", fileSizeBytes: 1, totalRows: 1 },
      b.admin.id,
    );
    expect(job.companyId).toBe(b.companyId);
  });

  it("lib:import/jobs/getImportJob", async () => {
    expect(await getImportJob(b.companyId, a.reviewJob.id)).toBeNull();
  });

  it("lib:import/jobs/appendImportRows", async () => {
    // B's company id on A's job: the composite key refuses the rows.
    await expect(
      appendImportRows(b.companyId, a.uploadingJob.id, {
        sheet: "personas",
        rows: [{ rowNumber: 2, cells: { nombres: "X" } }],
      }),
    ).rejects.toThrow();
    expect(
      await ownerDb
        .select()
        .from(importRows)
        .where(eq(importRows.jobId, a.uploadingJob.id)),
    ).toEqual([]);
  });

  it("lib:import/jobs/countStagedRows", async () => {
    expect(await countStagedRows(b.companyId, a.reviewJob.id)).toEqual({});
  });

  it("lib:import/jobs/finalizeImportUpload", async () => {
    const before = await snapshotTenant(a);
    expect(
      (await finalizeImportUpload(b.companyId, a.uploadingJob.id, 0)).job,
    ).toBeNull();
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("lib:import/jobs/listImportRows", async () => {
    expect((await listImportRows(b.companyId, a.reviewJob.id)).rows).toEqual(
      [],
    );
  });

  it("lib:import/jobs/listImportJobs", async () => {
    noLeak(await listImportJobs(b.companyId));
  });

  it("lib:import/route-helpers/loadUploadingJob", async () => {
    expect(
      (await loadUploadingJob(b.companyId, a.uploadingJob.id, a.admin.id)).error
        ?.status,
    ).toBe(404);
  });

  it("lib:import/apply/applyJobStep", async () => {
    await expect(applyJobStep(b.companyId, a.reviewJob.id)).rejects.toThrow(
      "No encontramos esta importación.",
    );
  });

  it("lib:import/apply/pauseApply", async () => {
    expect(await pauseApply(b.companyId, a.reviewJob.id)).toBe(false);
  });

  it("lib:import/error-report/loadErrorRows", async () => {
    expect(await loadErrorRows(b.companyId, a.reviewJob.id)).toEqual([]);
  });

  it("lib:import/error-report/buildErrorReport", async () => {
    expect((await buildErrorReport(b.companyId, a.reviewJob.id)).count).toBe(0);
  });

  it("lib:import/undo/previewUndo", async () => {
    await expect(previewUndo(b.companyId, a.reviewJob.id)).rejects.toThrow(
      "No encontramos esta importación.",
    );
  });

  it("lib:import/undo/undoJobStep", async () => {
    await expect(undoJobStep(b.companyId, a.reviewJob.id)).rejects.toThrow();
  });

  it("lib:import/validate/loadCatalogIndex", async () => {
    const index = await loadCatalogIndex(b.companyId);
    noLeak([
      ...index.areas.values(),
      ...index.sites.values(),
      ...index.positions.values(),
    ]);
  });

  it("lib:import/validate/loadLookups", async () => {
    const lookups = await loadLookups(b.companyId, [
      {
        rowNumber: 2,
        idWorkia: a.person.id,
        curp: a.person.curp,
        rfc: a.person.rfc,
      },
    ]);
    expect([
      lookups.byId.size,
      lookups.byCurp.size,
      lookups.byRfc.size,
    ]).toEqual([0, 0, 0]);
  });

  it.each([
    [
      "lib:import/validate/validatePersonasChunk",
      () =>
        validatePersonasChunk(b.companyId, a.reviewJob.id).catch(
          (error: Error) => error.message,
        ),
    ],
    [
      "lib:import/validate/resolveManagers",
      () => resolveManagers(b.companyId, a.reviewJob.id),
    ],
    [
      "lib:import/validate/validateHorariosChunk",
      () => validateHorariosChunk(b.companyId, a.reviewJob.id),
    ],
    [
      "lib:import/validate/validateContratosChunk",
      () => validateContratosChunk(b.companyId, a.reviewJob.id),
    ],
    [
      "lib:import/validate/countJobRows",
      () => countJobRows(b.companyId, a.reviewJob.id),
    ],
    [
      "lib:import/validate/validateJobStep",
      () =>
        validateJobStep(b.companyId, a.reviewJob.id).catch(
          (error: Error) => error.message,
        ),
    ],
    [
      "lib:import/validate/restartValidation",
      () =>
        restartValidation(b.companyId, a.reviewJob.id, { mode: "valid_only" }),
    ],
  ])("%s", async (_surface, run) => {
    const before = await snapshotTenant(a);
    const rowsBefore = await ownerDb
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, a.reviewJob.id));
    noLeak(await run());
    expect(await snapshotTenant(a)).toEqual(before);
    expect(
      await ownerDb
        .select()
        .from(importRows)
        .where(eq(importRows.jobId, a.reviewJob.id)),
    ).toEqual(rowsBefore);
  });
});

describe("importing into A never touches B", () => {
  it("creates a new person in A for a CURP of B, and refuses B's Workia id", async () => {
    const curp = validCurp("GODE561231HDFRRN0");
    await ownerDb
      .update(people)
      .set({ curp })
      .where(eq(people.id, b.person.id));

    const job = await createImportJob(
      a.companyId,
      {
        fileName: "cruce.xlsx",
        fileHash: "cruce",
        fileSizeBytes: 1,
        totalRows: 2,
      },
      a.admin.id,
    );
    await appendImportRows(a.companyId, job.id, {
      sheet: "personas",
      rows: [
        {
          rowNumber: 2,
          cells: { nombres: "Gonzalo", apellidoPaterno: "Doe", curp },
        },
        {
          rowNumber: 3,
          cells: {
            idWorkia: b.person.id,
            nombres: "Robado",
            apellidoPaterno: "B",
          },
        },
      ],
    });
    await finalizeImportUpload(a.companyId, job.id, 2);

    let step;
    do {
      step = await validateJobStep(a.companyId, job.id);
    } while (!step.done);

    const rows = await ownerDb
      .select({
        rowNumber: importRows.rowNumber,
        action: importRows.action,
        target: importRows.targetPersonId,
      })
      .from(importRows)
      .where(eq(importRows.jobId, job.id))
      .orderBy(importRows.rowNumber);

    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      action: "create",
      target: null,
    });
    expect(rows[1]).toMatchObject({ rowNumber: 3, action: "error" });
  });
});
