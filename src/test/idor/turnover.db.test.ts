/**
 * The turnover report (WRK-I12) against a real database: closed periods keep
 * the área, sucursal, puesto and jefe they had (every way a period closes),
 * the backfill is idempotent, the goal is audited and permission-checked, and
 * no company ever sees another's periods, names or goal.
 */

import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/reportes/rotacion/exportar/route";

import { withTransaction } from "@/lib/db";
import {
  areas,
  auditEvents,
  companies,
  employmentPeriods,
  people,
  peopleViews,
  terminationReasons,
} from "@/lib/db/schema";
import { createPerson } from "@/lib/people";
import { correctTermination, terminatePerson } from "@/lib/people/employment";
import { backfillTurnoverDimensions } from "@/lib/people/employment-backfill";
import type { PersonFormValues } from "@/lib/people/schema";
import { listPeopleViews } from "@/lib/people/views";
import {
  createTurnoverViewAction,
  deleteTurnoverViewAction,
  setTurnoverGoalAction,
} from "@/lib/reports/actions";
import { getTurnoverReport } from "@/lib/reports/turnover";
import {
  getTurnoverGoal,
  loadTurnoverFacts,
  loadTurnoverFiniquitos,
  loadTurnoverLabels,
  setTurnoverGoal,
} from "@/lib/reports/turnover/data";
import { turnoverFilterSchema } from "@/lib/reports/turnover/schema";
import {
  createTurnoverView,
  deleteTurnoverView,
  listTurnoverViews,
} from "@/lib/reports/turnover/views";
import { listTerminationReasons } from "@/lib/termination-reasons";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let reasonA: typeof terminationReasons.$inferSelect;
/** A second área of A, where people move after their baja. */
let otherAreaA: typeof areas.$inferSelect;
let leftA: typeof people.$inferSelect;

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Rotación",
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
  curp: "",
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

const baja = (fechaBaja: string) => ({
  fechaBaja,
  tipoBaja: "voluntaria" as const,
  motivoBajaId: reasonA.id,
  recontratable: true,
});

const periodsOf = (personId: string) =>
  ownerDb
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.personId, personId))
    .orderBy(employmentPeriods.createdAt);

const filter = (from: string, to: string) =>
  turnoverFilterSchema.parse({ from, to });

/** Moves a person to the other área of A (as editing the expediente would). */
const moveToOtherArea = (personId: string) =>
  ownerDb
    .update(people)
    .set({ areaId: otherAreaA.id })
    .where(eq(people.id, personId));

beforeAll(async () => {
  a = await seedTenant("RA");
  b = await seedTenant("RB");
  reasonA = (await listTerminationReasons(a.companyId)).find(
    (reason) => reason.name === "No aprobó el periodo de prueba",
  )!;
  [otherAreaA] = await ownerDb
    .insert(areas)
    .values({ companyId: a.companyId, name: "Área destino RA" })
    .returning();
  leftA = await createPerson(
    a.companyId,
    personForm({
      nombres: "Ximena",
      areaId: a.area.id,
      positionId: a.position.id,
      siteId: a.site.id,
      managerId: a.person.id,
    }),
    a.admin.id,
  );
  await terminatePerson(
    a.companyId,
    leftA.id,
    {
      ...baja("2025-03-31"),
      finiquito: { estado: "pagado", fecha: "2025-04-10", monto: 12345.67 },
    },
    a.admin.id,
  );
});

const exportUrl = (format: string, from = "2025-01-01", to = "2025-12-31") =>
  `http://test/app/reportes/rotacion/exportar?r=r1*desde.${from}*hasta.${to}&format=${format}`;

/** The audit event is written once the file is streamed: wait for it. */
const exportEventsOf = async (companyId: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, companyId),
          eq(auditEvents.resourceType, "report_export"),
        ),
      );

    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return [];
};

describe("closed periods keep their dimensions", () => {
  it("a baja from the dialog or the connector (recordTermination) freezes them", async () => {
    await moveToOtherArea(leftA.id);
    const [period] = await periodsOf(leftA.id);

    expect(period).toMatchObject({
      areaId: a.area.id,
      siteId: a.site.id,
      positionId: a.position.id,
      managerId: a.person.id,
    });

    const fact = (await loadTurnoverFacts(a.companyId)).find(
      (row) => row.id === period.id,
    );
    expect(fact?.areaId).toBe(a.area.id);
  });

  it("a person created already de baja (syncEmploymentPeriods) freezes them on the «sin fecha» period", async () => {
    const created = await createPerson(
      a.companyId,
      personForm({ nombres: "YaBaja", areaId: a.area.id, status: "baja" }),
      a.admin.id,
    );
    const [period] = await periodsOf(created.id);

    expect(period).toMatchObject({ bajaSinFecha: true, areaId: a.area.id });
  });

  it("a corrected baja (correctTermination) keeps what was frozen and fills gaps", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Corrige", areaId: a.area.id }),
      a.admin.id,
    );
    await terminatePerson(
      a.companyId,
      person.id,
      baja("2025-02-28"),
      a.admin.id,
    );
    // Since the baja: moved to another área and given a sucursal.
    await ownerDb
      .update(people)
      .set({ areaId: otherAreaA.id, siteId: a.site.id })
      .where(eq(people.id, person.id));

    await withTransaction(
      (tx) =>
        correctTermination(
          tx,
          a.companyId,
          person.id,
          baja("2025-03-15"),
          a.admin.id,
        ),
      a.companyId,
    );

    const [period] = await periodsOf(person.id);
    expect(period).toMatchObject({
      fechaBaja: "2025-03-15",
      areaId: a.area.id,
      siteId: a.site.id,
    });
  });

  it("the backfill fills closed periods once and then finds nothing", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Antigua", areaId: a.area.id }),
      a.admin.id,
    );
    await terminatePerson(
      a.companyId,
      person.id,
      baja("2025-04-30"),
      a.admin.id,
    );
    // As if it had closed before migration 0027.
    await ownerDb
      .update(employmentPeriods)
      .set({ areaId: null, siteId: null, positionId: null, managerId: null })
      .where(eq(employmentPeriods.personId, person.id));

    const dry = await backfillTurnoverDimensions({ companyId: a.companyId });
    expect(dry).toMatchObject({ applied: false });
    expect(dry.periods).toBeGreaterThanOrEqual(1);
    expect((await periodsOf(person.id))[0].areaId).toBeNull();

    const applied = await backfillTurnoverDimensions({
      apply: true,
      companyId: a.companyId,
    });
    expect(applied.periods).toBe(dry.periods);
    expect((await periodsOf(person.id))[0].areaId).toBe(a.area.id);

    expect(
      await backfillTurnoverDimensions({ apply: true, companyId: a.companyId }),
    ).toMatchObject({ periods: 0 });
  });
});

describe("the report", () => {
  it("counts a salida en prueba with its frozen área and the base reason's classification", async () => {
    const { report } = await getTurnoverReport(
      a.companyId,
      filter("2025-03-01", "2025-03-31"),
      { withDetail: true, today: "2025-12-31" },
    );
    const exit = report.detail!.exits.find((row) => row.personId === leftA.id);

    expect(exit).toMatchObject({
      areaId: a.area.id,
      classification: "involuntaria",
      days: 85,
    });
    expect(report.summary.trial.exits).toBeGreaterThanOrEqual(1);
    expect(report.summary.byClass.involuntaria.exits).toBeGreaterThanOrEqual(1);
  });

  it("leaves the people out without detail", async () => {
    const { report } = await getTurnoverReport(
      a.companyId,
      filter("2025-03-01", "2025-03-31"),
    );

    expect(report.detail).toBeNull();
  });
});

describe("the turnover goal", () => {
  it("is set, audited and cleared", async () => {
    expect(await getTurnoverGoal(a.companyId)).toBeNull();
    await setTurnoverGoal(a.companyId, 2.5, a.admin.id);
    expect(await getTurnoverGoal(a.companyId)).toBe(2.5);

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, a.companyId));
    expect(
      events.some((event) =>
        (event.payload as { summary?: string } | null)?.summary?.includes(
          "2.5% mensual",
        ),
      ),
    ).toBe(true);

    await setTurnoverGoal(a.companyId, null, a.admin.id);
    expect(await getTurnoverGoal(a.companyId)).toBeNull();
  });

  it("refuses a goal out of range in the database too", async () => {
    await expect(
      ownerDb
        .update(companies)
        .set({ turnoverGoalPct: "0" })
        .where(eq(companies.id, a.companyId)),
    ).rejects.toThrow();
  });
});

describe("turnover stays inside the company", () => {
  it("lib:reports/turnover/data/loadTurnoverFacts", async () => {
    const facts = await loadTurnoverFacts(b.companyId);
    const ids = new Set(
      (
        await ownerDb
          .select({ id: employmentPeriods.id })
          .from(employmentPeriods)
          .where(eq(employmentPeriods.companyId, a.companyId))
      ).map((row) => row.id),
    );

    expect(facts.some((fact) => ids.has(fact.id))).toBe(false);
    expect(facts.some((fact) => fact.personId === leftA.id)).toBe(false);
  });

  it("lib:reports/turnover/data/loadTurnoverLabels", async () => {
    const labels = await loadTurnoverLabels(b.companyId);

    expect(labels.areas[a.area.id]).toBeUndefined();
    expect(labels.areas[otherAreaA.id]).toBeUndefined();
    expect(labels.managers[a.person.id]).toBeUndefined();
    expect(Object.keys(labels.reportsOf)).not.toContain(a.person.id);
  });

  it("lib:reports/turnover/getTurnoverReport", async () => {
    const { report, labels } = await getTurnoverReport(
      b.companyId,
      filter("2025-01-01", "2025-12-31"),
      { withDetail: true },
    );
    const serialized = JSON.stringify({ report, labels });

    expect(serialized).not.toContain(leftA.id);
    expect(serialized).not.toContain(a.area.id);
    expect(report.summary.exits).toBe(0);
  });

  it("lib:reports/turnover/data/getTurnoverGoal", async () => {
    await setTurnoverGoal(a.companyId, 3, a.admin.id);
    expect(await getTurnoverGoal(b.companyId)).toBeNull();
    await setTurnoverGoal(a.companyId, null, a.admin.id);
  });

  it("lib:reports/turnover/data/setTurnoverGoal", async () => {
    await setTurnoverGoal(b.companyId, 4, b.admin.id);
    expect(await getTurnoverGoal(a.companyId)).toBeNull();
    await setTurnoverGoal(b.companyId, null, b.admin.id);
  });

  it("action:reports/setTurnoverGoalAction", async () => {
    actAs(b.admin);
    // A dashboard opened in company A cannot set A's goal from B's session.
    expect(
      await setTurnoverGoalAction({ companyId: a.companyId, goal: 5 }),
    ).toMatchObject({ ok: false });
    expect(await getTurnoverGoal(a.companyId)).toBeNull();

    expect(
      await setTurnoverGoalAction({ companyId: b.companyId, goal: 5 }),
    ).toEqual({ ok: true, goal: 5 });
    expect(await getTurnoverGoal(b.companyId)).toBe(5);
    expect(await getTurnoverGoal(a.companyId)).toBeNull();

    expect(
      await setTurnoverGoalAction({ companyId: b.companyId, goal: 150 }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("100") });
    await setTurnoverGoalAction({ companyId: b.companyId, goal: null });
  });
});

describe("exports and views", () => {
  it("exports every sheet with the finiquito for compensation:read, and audits it", async () => {
    actAs(a.admin);
    const response = await exportRoute(new Request(exportUrl("xlsx")));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Mensual",
      "Por área",
      "Por sucursal",
      "Por jefe",
      "Por motivo",
      "Cohortes",
      "Bajas",
    ]);

    const bajas = workbook.getWorksheet("Bajas")!;
    const header = (bajas.getRow(1).values as unknown[]).slice(1);
    const cells: unknown[] = [];
    bajas.eachRow((row) => cells.push(...(row.values as unknown[])));

    expect(header).toContain("Monto del finiquito");
    expect(cells).toContain(12345.67);
    expect(cells.some((cell) => String(cell).includes("Ximena"))).toBe(true);

    const [event] = await exportEventsOf(a.companyId);
    expect(event).toMatchObject({ action: "export" });
    expect(event.payload).toMatchObject({
      after: { report: "rotacion", format: "xlsx", includeFiniquito: true },
    });
  });

  it("saves views of the report apart from the Personas views, presets relative", async () => {
    const view = await createTurnoverView(
      a.companyId,
      a.admin.id,
      {
        name: "Trimestral A",
        shared: false,
        filter: filter("2025-07-01", "2025-09-30"),
      },
      "2025-10-15",
    );
    const [listed] = await listTurnoverViews(
      a.companyId,
      a.admin.id,
      "2026-02-10",
    );

    expect(listed).toMatchObject({ id: view.id, preset: "trimestre" });
    // Opened months later, «último trimestre» is the last closed one then.
    expect(listed.filter).toMatchObject({
      from: "2025-10-01",
      to: "2025-12-31",
    });
    expect(
      (
        await listPeopleViews(a.companyId, {
          userId: a.admin.id,
          permissions: new Set(["people:read"]),
        })
      ).map((row) => row.id),
    ).not.toContain(view.id);

    expect(await deleteTurnoverView(a.companyId, a.viewer.id, view.id)).toBe(
      false,
    );
    expect(await deleteTurnoverView(a.companyId, a.admin.id, view.id)).toBe(
      true,
    );
  });
});

describe("turnover exports and views stay inside the company", () => {
  it("route:GET /app/reportes/rotacion/exportar", async () => {
    actAs(b.admin);
    const response = await exportRoute(new Request(exportUrl("csv")));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(leftA.nombres);
    expect(text).not.toContain("12345");
    expect(response.headers.get("Content-Disposition")).toContain(
      b.company.slug,
    );
  });

  it("lib:reports/turnover/data/loadTurnoverFiniquitos", async () => {
    const own = await loadTurnoverFiniquitos(a.companyId);
    const other = await loadTurnoverFiniquitos(b.companyId);

    expect(own.some((row) => row.monto === 12345.67)).toBe(true);
    expect(other.some((row) => row.monto === 12345.67)).toBe(false);
  });

  it("lib:reports/turnover/views/createTurnoverView", async () => {
    const view = await createTurnoverView(
      b.companyId,
      b.admin.id,
      {
        name: "Sólo B",
        shared: true,
        filter: filter("2025-01-01", "2025-03-31"),
      },
      "2025-10-15",
    );
    const [row] = await ownerDb
      .select()
      .from(peopleViews)
      .where(eq(peopleViews.id, view.id));

    expect(row).toMatchObject({ companyId: b.companyId, kind: "turnover" });
  });

  it("lib:reports/turnover/views/listTurnoverViews", async () => {
    await createTurnoverView(
      a.companyId,
      a.admin.id,
      {
        name: "Compartida A",
        shared: true,
        filter: filter("2025-01-01", "2025-03-31"),
      },
      "2025-10-15",
    );
    const names = (
      await listTurnoverViews(b.companyId, b.admin.id, "2025-10-15")
    ).map((view) => view.name);

    expect(names).not.toContain("Compartida A");
  });

  it("lib:reports/turnover/views/deleteTurnoverView", async () => {
    const [own] = await listTurnoverViews(
      a.companyId,
      a.admin.id,
      "2025-10-15",
    );

    expect(await deleteTurnoverView(b.companyId, b.admin.id, own.id)).toBe(
      false,
    );
    expect(
      (await listTurnoverViews(a.companyId, a.admin.id, "2025-10-15")).map(
        (view) => view.id,
      ),
    ).toContain(own.id);
  });

  it("action:reports/createTurnoverViewAction", async () => {
    actAs(b.admin);
    expect(
      await createTurnoverViewAction({
        companyId: a.companyId,
        name: "Intrusa",
        shared: true,
        filter: filter("2025-01-01", "2025-03-31"),
      }),
    ).toMatchObject({ ok: false });
    expect(
      (await listTurnoverViews(a.companyId, a.admin.id, "2025-10-15")).map(
        (view) => view.name,
      ),
    ).not.toContain("Intrusa");
  });

  it("action:reports/deleteTurnoverViewAction", async () => {
    const [own] = await listTurnoverViews(
      a.companyId,
      a.admin.id,
      "2025-10-15",
    );

    actAs(b.admin);
    expect(await deleteTurnoverViewAction(own.id)).toMatchObject({ ok: false });
    expect(
      (await listTurnoverViews(a.companyId, a.admin.id, "2025-10-15")).map(
        (view) => view.id,
      ),
    ).toContain(own.id);
  });
});

describe("turnover permissions", () => {
  it("rbac:route:GET /app/reportes/rotacion/exportar", async () => {
    // Viewers have neither reports:read nor people:export.
    actAs(b.viewer);
    expect((await exportRoute(new Request(exportUrl("csv")))).status).toBe(403);
  });

  it("rbac:action:reports/createTurnoverViewAction", async () => {
    actAs(b.viewer);
    expect(
      await createTurnoverViewAction({
        companyId: b.companyId,
        name: "Sin permiso",
        shared: false,
        filter: filter("2025-01-01", "2025-03-31"),
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/permiso/) });
  });

  it("rbac:action:reports/deleteTurnoverViewAction", async () => {
    const [view] = await listTurnoverViews(
      b.companyId,
      b.admin.id,
      "2025-10-15",
    );

    actAs(b.viewer);
    expect(await deleteTurnoverViewAction(view.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/permiso/),
    });
    expect(
      (await listTurnoverViews(b.companyId, b.admin.id, "2025-10-15")).map(
        (row) => row.id,
      ),
    ).toContain(view.id);
  });

  it("rbac:action:reports/setTurnoverGoalAction", async () => {
    for (const user of [b.viewer, b.editor]) {
      actAs(user);
      expect(
        await setTurnoverGoalAction({ companyId: b.companyId, goal: 7 }),
      ).toMatchObject({ ok: false, error: expect.stringMatching(/permiso/) });
    }
    expect(await getTurnoverGoal(b.companyId)).toBeNull();
  });
});
