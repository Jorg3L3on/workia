/**
 * Absenteeism and turnover by región and sucursal (Workia 2.0 W2-20) against
 * a real database: turnover reconciles with the turnover report person by
 * person, absenteeism comes from the attendance aggregates by the person's
 * current sucursal, regiones add up their sucursales, and no company ever
 * sees another's numbers, names or saved views. Titles are the surface ids in
 * docs/idor-matrix.md.
 */

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/reportes/ausentismo/exportar/route";

import { people, regions, sites, terminationReasons } from "@/lib/db/schema";
import { createPerson } from "@/lib/people";
import { terminatePerson } from "@/lib/people/employment";
import type { PersonFormValues } from "@/lib/people/schema";
import {
  getAbsenteeismReport,
  loadAbsenteeismDetail,
  type AbsenteeismReport,
} from "@/lib/reports/absenteeism";
import { loadReportStructure } from "@/lib/reports/absenteeism/data";
import {
  absenteeismFilterSchema,
  MAX_ABSENTEEISM_RANGE_DAYS,
} from "@/lib/reports/absenteeism/schema";
import {
  createAbsenteeismView,
  deleteAbsenteeismView,
  listAbsenteeismViews,
} from "@/lib/reports/absenteeism/views";
import {
  createAbsenteeismViewAction,
  deleteAbsenteeismViewAction,
} from "@/lib/reports/actions";
import { getTurnoverReport } from "@/lib/reports/turnover";
import { turnoverFilterSchema } from "@/lib/reports/turnover/schema";
import { listTerminationReasons } from "@/lib/termination-reasons";
import { appendPersonEvents, attendanceDedupeKey } from "@/lib/timeline";
import { MAX_AGGREGATE_DAYS } from "@/lib/timeline/aggregates";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const FROM = "2026-10-01";
const TO = "2026-10-31";
const TODAY = "2026-11-04";

let a: Tenant;
let b: Tenant;
let norte: typeof regions.$inferSelect;
let sur: typeof sites.$inferSelect;
let centro: typeof sites.$inferSelect;
let reason: typeof terminationReasons.$inferSelect;
let firing: typeof terminationReasons.$inferSelect;
const staff: { id: string; nombres: string }[] = [];
let moved: { id: string; nombres: string };
let surLeaver: { id: string; nombres: string };

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Ausentismo",
  apellidoPaterno: "Prueba",
  apellidoMaterno: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  fechaIngreso: "2025-01-06",
  areaId: "",
  positionId: "",
  managerId: "",
  siteId: "",
  rfc: "",
  curp: uniqueCurp(),
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

const filter = (input: Record<string, unknown> = {}) =>
  absenteeismFilterSchema.parse({ from: FROM, to: TO, ...input });

const siteRow = (report: AbsenteeismReport, siteId: string | null) =>
  report.regions
    .flatMap((region) => region.sites)
    .find((row) => row.key === siteId);

const attendance = (personId: string, day: string) => ({
  personId,
  type: "attendance" as const,
  occurredAt: new Date(`${day}T15:00:00Z`),
  source: "checador",
  dedupeKey: attendanceDedupeKey(day),
  payload: { punches: [[`${day}T15:00:00Z`, "in"]] },
});

const incidencia = (
  personId: string,
  day: string,
  payload: Record<string, unknown>,
) => ({
  personId,
  type: "incidencia" as const,
  occurredAt: new Date(`${day}T15:00:00Z`),
  source: "engine",
  payload: { date: day, ...payload },
});

const exportUrl = (format: string, extra = "") =>
  `http://test/app/reportes/ausentismo/exportar?a=a1*desde.${FROM}*hasta.${TO}${extra}&format=${format}`;

beforeAll(async () => {
  a = await seedTenant("AUA");
  b = await seedTenant("AUB");
  const reasons = await listTerminationReasons(a.companyId);
  reason = reasons.find((row) => row.classification === "voluntaria")!;
  firing = reasons.find((row) => row.classification === "involuntaria")!;
  [norte] = await ownerDb
    .insert(regions)
    .values({ companyId: a.companyId, name: "Norte AUA" })
    .returning();
  await ownerDb
    .update(sites)
    .set({ regionId: norte.id })
    .where(eq(sites.id, a.site.id));
  [sur] = await ownerDb
    .insert(sites)
    .values({
      companyId: a.companyId,
      name: "Sur AUA",
      kind: "sucursal",
      regionId: norte.id,
    })
    .returning();
  [centro] = await ownerDb
    .insert(sites)
    .values({ companyId: a.companyId, name: "Centro AUA", kind: "sucursal" })
    .returning();

  // Seven people at A's site, one at Sur.
  for (const nombres of [
    "Ana",
    "Beto",
    "Carla",
    "Dario",
    "Elena",
    "Fabian",
    "Gina",
  ]) {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres, siteId: a.site.id }),
      a.admin.id,
    );
    staff.push({ id: person.id, nombres });
  }

  const surPerson = await createPerson(
    a.companyId,
    personForm({ nombres: "Hector", siteId: sur.id }),
    a.admin.id,
  );
  surLeaver = { id: surPerson.id, nombres: "Hector" };

  // Two bajas at A's site in October; Fabian then moves to Centro, but his
  // baja stays at A's site (the period froze it), as in Rotación.
  await terminatePerson(
    a.companyId,
    staff[4].id,
    {
      fechaBaja: "2026-10-10",
      tipoBaja: "voluntaria",
      motivoBajaId: reason.id,
      recontratable: true,
    },
    a.admin.id,
  );
  await terminatePerson(
    a.companyId,
    staff[5].id,
    {
      fechaBaja: "2026-10-20",
      tipoBaja: "despido",
      motivoBajaId: firing.id,
      recontratable: false,
    },
    a.admin.id,
  );
  moved = staff[5];
  await ownerDb
    .update(people)
    .set({ siteId: centro.id })
    .where(eq(people.id, moved.id));
  // A baja outside the range does not count.
  await terminatePerson(
    a.companyId,
    surLeaver.id,
    {
      fechaBaja: "2026-09-15",
      tipoBaja: "voluntaria",
      motivoBajaId: reason.id,
      recontratable: true,
    },
    a.admin.id,
  );

  // Ana: 3 days present, 1 falta, 1 retardo of 12 minutes. Fabian (now at
  // Centro): 1 day present, 1 justified falta. A voided falta does not count.
  await appendPersonEvents(a.companyId, [
    attendance(staff[0].id, "2026-10-05"),
    attendance(staff[0].id, "2026-10-06"),
    attendance(staff[0].id, "2026-10-07"),
    incidencia(staff[0].id, "2026-10-08", { kind: "falta" }),
    incidencia(staff[0].id, "2026-10-06", { kind: "retardo", minutes: 12 }),
    incidencia(staff[0].id, "2026-10-09", { kind: "falta" }),
    incidencia(staff[0].id, "2026-10-09", {
      kind: "falta",
      rev: 1,
      voided: true,
    }),
    attendance(moved.id, "2026-10-05"),
    incidencia(moved.id, "2026-10-06", { kind: "falta", justified: true }),
  ]);
});

describe("lib:reports/absenteeism/data/getAbsenteeismReport", () => {
  it("allows exactly the range the attendance aggregates read", () => {
    expect(MAX_ABSENTEEISM_RANGE_DAYS).toBe(MAX_AGGREGATE_DAYS);
  });

  it("reconciles turnover with the turnover report, person by person", async () => {
    const report = await getAbsenteeismReport(a.companyId, filter(), TODAY);
    const { report: turnover } = await getTurnoverReport(
      a.companyId,
      turnoverFilterSchema.parse({ from: FROM, to: TO }),
      { withDetail: true, today: TODAY },
    );
    const inRange = (turnover.detail?.exits ?? []).filter(
      (row) => row.fechaBaja! >= FROM && row.fechaBaja! <= TO,
    );

    expect(report.total.turnover.exits).toBe(turnover.summary.exits);
    expect(report.total.turnover.headcount).toBe(turnover.summary.headcount);
    expect(report.total.turnover.exits).toBe(2);

    const detail = await loadAbsenteeismDetail(
      a.companyId,
      filter(),
      report.structure.sites,
    );
    expect(detail.exits.map((row) => row.periodId).sort()).toEqual(
      inRange.map((row) => row.id).sort(),
    );

    // Each sucursal matches Rotación filtered to it.
    for (const site of [a.site.id, sur.id, centro.id]) {
      const { report: one } = await getTurnoverReport(
        a.companyId,
        turnoverFilterSchema.parse({ from: FROM, to: TO, siteIds: [site] }),
        { today: TODAY },
      );
      const row = siteRow(report, site);

      expect(row?.turnover.exits ?? 0).toBe(one.summary.exits);
      expect(row?.turnover.headcount ?? 0).toBe(one.summary.headcount);
    }

    const main = siteRow(report, a.site.id)!;
    expect(main.turnover.exits).toBe(2);
    expect(main.turnover.voluntaryExits).toBe(1);
    expect(main.turnover.involuntaryExits).toBe(1);
    expect(main.turnover.rate).not.toBeNull();
    // Fabian's baja is not at Centro, where he is now.
    expect(siteRow(report, centro.id)!.turnover.exits).toBe(0);
  });

  it("computes absenteeism by the person's current sucursal and adds up regiones", async () => {
    const report = await getAbsenteeismReport(a.companyId, filter(), TODAY);
    const main = siteRow(report, a.site.id)!;

    expect(main.absenteeism).toEqual({
      presentDays: 3,
      absentDays: 1,
      justifiedAbsentDays: 0,
      rate: 25,
      lateDays: 1,
      lateMinutes: 12,
    });
    expect(siteRow(report, centro.id)!.absenteeism).toMatchObject({
      presentDays: 1,
      absentDays: 1,
      justifiedAbsentDays: 1,
      rate: 50,
    });

    const region = report.regions.find((row) => row.key === norte.id)!;
    expect(region.sites.map((row) => row.label)).toEqual([
      "Sucursal AUA",
      "Sur AUA",
    ]);
    expect(region.absenteeism.absentDays).toBe(1);
    expect(region.turnover.exits).toBe(2);
    expect(report.total.absenteeism.absentDays).toBe(2);
    expect(report.total.absenteeism.rate).toBeCloseTo((2 / 6) * 100, 2);

    // Centro has no región: it goes under «Sin región», last.
    expect(report.regions.at(-1)!.key).toBeNull();
    expect(report.regions.at(-1)!.sites.map((row) => row.key)).toContain(
      centro.id,
    );
  });

  it("narrows to a región", async () => {
    const report = await getAbsenteeismReport(
      a.companyId,
      filter({ regionIds: [norte.id] }),
      TODAY,
    );

    expect(report.regions.map((row) => row.key)).toEqual([norte.id]);
    expect(report.total.absenteeism.absentDays).toBe(1);
    expect(report.total.turnover.exits).toBe(2);
  });

  it("returns nothing of company A to company B", async () => {
    const report = await getAbsenteeismReport(
      b.companyId,
      filter({ siteIds: [a.site.id] }),
      TODAY,
    );
    const all = await getAbsenteeismReport(b.companyId, filter(), TODAY);

    expect(report.regions).toEqual([]);
    expect(report.total.turnover.exits).toBe(0);
    expect(all.total.turnover.exits).toBe(0);
    expect(all.total.absenteeism.absentDays).toBe(0);
    expect(JSON.stringify(all)).not.toContain("AUA");
  });
});

describe("lib:reports/absenteeism/data/loadAbsenteeismDetail", () => {
  it("lists A's people only for A", async () => {
    const own = await loadAbsenteeismDetail(a.companyId, filter(), []);
    const other = await loadAbsenteeismDetail(b.companyId, filter(), []);

    expect(own.people.map((row) => row.personId)).toContain(staff[0].id);
    expect(own.people.find((row) => row.personId === staff[0].id)!.rate).toBe(
      25,
    );
    expect(other.exits).toEqual([]);
    expect(other.people).toEqual([]);
  });
});

describe("lib:reports/absenteeism/data/loadReportStructure", () => {
  it("reads only the company's sucursales and regiones", async () => {
    const own = await loadReportStructure(a.companyId);
    const other = await loadReportStructure(b.companyId);

    expect(own.regions.map((row) => row.id)).toContain(norte.id);
    expect(other.regions.map((row) => row.id)).not.toContain(norte.id);
    expect(other.sites.map((row) => row.id)).not.toContain(sur.id);
  });
});

describe("absenteeism exports and views stay inside the company", () => {
  it("route:GET /app/reportes/ausentismo/exportar", async () => {
    actAs(a.admin);
    const response = await exportRoute(new Request(exportUrl("xlsx")));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Bajas",
      "Ausentismo por persona",
    ]);
    const bajas = workbook.getWorksheet("Bajas")!;
    expect(bajas.rowCount).toBe(3);
    expect(String(bajas.getRow(2).getCell(1).value)).toContain("Elena");
    expect(bajas.getRow(3).getCell(6).value).toBe("Sucursal AUA");

    actAs(b.admin);
    const csv = await exportRoute(new Request(exportUrl("csv")));
    const text = await csv.text();

    expect(csv.status).toBe(200);
    expect(text).not.toContain("AUA");
    expect(csv.headers.get("Content-Disposition")).toContain(b.company.slug);
  });

  it("rbac:route:GET /app/reportes/ausentismo/exportar", async () => {
    // Viewers and editors have no reports:read: no table, no people.
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      for (const format of ["csv", "xlsx"]) {
        expect((await exportRoute(new Request(exportUrl(format)))).status).toBe(
          403,
        );
      }
    }
  });

  it("lib:reports/absenteeism/views/createAbsenteeismView", async () => {
    const view = await createAbsenteeismView(
      b.companyId,
      b.admin.id,
      { name: "Sólo B", shared: true, filter: filter() },
      TODAY,
    );

    expect(
      (await listAbsenteeismViews(a.companyId, a.admin.id, TODAY)).map(
        (row) => row.id,
      ),
    ).not.toContain(view.id);
    await deleteAbsenteeismView(b.companyId, b.admin.id, view.id);
  });

  it("lib:reports/absenteeism/views/listAbsenteeismViews", async () => {
    const view = await createAbsenteeismView(
      a.companyId,
      a.admin.id,
      { name: "Norte mensual", shared: true, filter: filter() },
      TODAY,
    );

    // Saved on «último mes»: it stays relative.
    const [listed] = (
      await listAbsenteeismViews(a.companyId, a.editor.id, "2026-12-03")
    ).filter((row) => row.id === view.id);
    expect(listed).toMatchObject({
      preset: "mes",
      isOwner: false,
      filter: { from: "2026-11-01", to: "2026-11-30" },
    });
    expect(await listAbsenteeismViews(b.companyId, b.admin.id, TODAY)).toEqual(
      [],
    );
    await deleteAbsenteeismView(a.companyId, a.admin.id, view.id);
  });

  it("lib:reports/absenteeism/views/deleteAbsenteeismView", async () => {
    const view = await createAbsenteeismView(
      a.companyId,
      a.admin.id,
      { name: "De A", shared: true, filter: filter() },
      TODAY,
    );

    expect(await deleteAbsenteeismView(b.companyId, b.admin.id, view.id)).toBe(
      false,
    );
    expect(await deleteAbsenteeismView(a.companyId, a.editor.id, view.id)).toBe(
      false,
    );
    expect(await deleteAbsenteeismView(a.companyId, a.admin.id, view.id)).toBe(
      true,
    );
  });

  it("action:reports/createAbsenteeismViewAction", async () => {
    actAs(b.admin);
    expect(
      await createAbsenteeismViewAction({
        companyId: a.companyId,
        name: "Intruso",
        shared: false,
        filter: filter(),
      }),
    ).toMatchObject({ ok: false });
    expect(await listAbsenteeismViews(a.companyId, b.admin.id, TODAY)).toEqual(
      [],
    );

    actAs(a.admin);
    const created = await createAbsenteeismViewAction({
      companyId: a.companyId,
      name: "Mía",
      shared: false,
      filter: filter(),
    });
    expect(created).toMatchObject({ ok: true });

    if (created.ok) {
      await deleteAbsenteeismView(a.companyId, a.admin.id, created.id);
    }
  });

  it("action:reports/deleteAbsenteeismViewAction", async () => {
    const view = await createAbsenteeismView(
      a.companyId,
      a.admin.id,
      { name: "No la borres", shared: true, filter: filter() },
      TODAY,
    );

    actAs(b.admin);
    expect(await deleteAbsenteeismViewAction(view.id)).toMatchObject({
      ok: false,
    });

    actAs(a.admin);
    expect(await deleteAbsenteeismViewAction(view.id)).toEqual({ ok: true });
  });
});
