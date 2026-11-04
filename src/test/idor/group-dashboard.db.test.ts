/**
 * Group dashboards (Workia 2.0 W2-25) against a real database: each company
 * row is exactly that company's absenteeism report, the group leaves a
 * transfer between two of its companies out of its turnover, and a user sees
 * only the companies where they have reports:read (all of them with the group
 * admin grant). Each company is read under its own row-level security.
 * Titles are the surface ids in docs/idor-matrix.md.
 */

import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/reportes/grupo/exportar/route";

import { auditEvents, companyMemberships, users } from "@/lib/db/schema";
import { createPerson } from "@/lib/people";
import { terminatePerson } from "@/lib/people/employment";
import type { PersonFormValues } from "@/lib/people/schema";
import { getAbsenteeismReport } from "@/lib/reports/absenteeism";
import { loadAbsenteeismInputs } from "@/lib/reports/absenteeism/data";
import { absenteeismFilterSchema } from "@/lib/reports/absenteeism/schema";
import {
  getGroupDashboard,
  loadCompanyTransfers,
  loadGroupReportReader,
} from "@/lib/reports/group";
import { groupFilterSchema } from "@/lib/reports/group/schema";
import { appendPersonEvents, attendanceDedupeKey } from "@/lib/timeline";
import { listTerminationReasons } from "@/lib/termination-reasons";
import { transferPerson } from "@/lib/transfers";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedRbac, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const FROM = "2026-10-01";
const TO = "2026-10-31";
const TODAY = "2026-11-04";

let a: Tenant;
let b: Tenant;
let c: Tenant;
/** Admin (reports:read) in A and B. */
let hr: { id: string; email: string };
/** Viewer in A, admin in C: reads only C's reports. */
let mixed: { id: string; email: string };
/** Group admin with no membership in C. */
let groupAdmin: { id: string; email: string };
let movedFrom: string;
let movedTo: string;

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Grupo",
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

const newUser = async (email: string) =>
  (await ownerDb.insert(users).values({ email, name: email }).returning())[0];

const attendance = (personId: string, day: string) => ({
  personId,
  type: "attendance" as const,
  occurredAt: new Date(`${day}T15:00:00Z`),
  source: "checador",
  dedupeKey: attendanceDedupeKey(day),
  payload: { punches: [[`${day}T15:00:00Z`, "in"]] },
});

const falta = (personId: string, day: string) => ({
  personId,
  type: "incidencia" as const,
  occurredAt: new Date(`${day}T15:00:00Z`),
  source: "engine",
  payload: { date: day, kind: "falta" },
});

const filter = (companyIds: string[] = []) =>
  groupFilterSchema.parse({ from: FROM, to: TO, companyIds });

const exportUrl = (format: string, extra = "") =>
  `http://test/app/reportes/grupo/exportar?g=g1*desde.${FROM}*hasta.${TO}${extra}&format=${format}`;

beforeAll(async () => {
  a = await seedTenant("GRA");
  b = await seedTenant("GRB");
  c = await seedTenant("GRC");
  const roles = await seedRbac();
  const stamp = Date.now();
  hr = await newUser(`grupo-hr-${stamp}@idor.test`);
  mixed = await newUser(`grupo-mixto-${stamp}@idor.test`);
  groupAdmin = await newUser(`grupo-admin-${stamp}@idor.test`);
  await ownerDb
    .update(users)
    .set({ isGroupAdmin: true })
    .where(eq(users.id, groupAdmin.id));
  await ownerDb.insert(companyMemberships).values([
    {
      userId: hr.id,
      companyId: a.companyId,
      roleId: roles.get("admin")!,
      isDefault: true,
    },
    { userId: hr.id, companyId: b.companyId, roleId: roles.get("admin")! },
    {
      userId: mixed.id,
      companyId: a.companyId,
      roleId: roles.get("viewer")!,
      isDefault: true,
    },
    { userId: mixed.id, companyId: c.companyId, roleId: roles.get("admin")! },
    {
      userId: groupAdmin.id,
      companyId: a.companyId,
      roleId: roles.get("viewer")!,
      isDefault: true,
    },
  ]);

  // A: six people, one quits in October, one moves to B on 2026-10-16.
  const staffA = [];
  for (const nombres of ["Ana", "Beto", "Carla", "Dario", "Elena", "Fabian"]) {
    staffA.push(
      await createPerson(
        a.companyId,
        personForm({ nombres, siteId: a.site.id }),
        a.admin.id,
      ),
    );
  }
  await terminatePerson(
    a.companyId,
    staffA[4].id,
    {
      fechaBaja: "2026-10-10",
      tipoBaja: "voluntaria",
      motivoBajaId: (await listTerminationReasons(a.companyId)).find(
        (row) => row.classification === "voluntaria",
      )!.id,
      recontratable: true,
    },
    a.admin.id,
  );
  const transfer = await transferPerson(
    a.companyId,
    staffA[5].id,
    {
      toCompanyId: b.companyId,
      fechaTraslado: "2026-10-16",
      siteId: b.site.id,
    },
    hr.id,
  );
  movedFrom = staffA[5].id;
  movedTo = transfer!.toPersonId;

  // B: five people of its own.
  for (const nombres of ["Gina", "Hugo", "Irma", "Juan", "Karla"]) {
    await createPerson(
      b.companyId,
      personForm({ nombres, siteId: b.site.id }),
      b.admin.id,
    );
  }

  // C: one person with attendance, never shown to A's or B's readers.
  const cPerson = await createPerson(
    c.companyId,
    personForm({ nombres: "Lola", siteId: c.site.id }),
    c.admin.id,
  );

  await appendPersonEvents(a.companyId, [
    attendance(staffA[0].id, "2026-10-05"),
    attendance(staffA[0].id, "2026-10-06"),
    attendance(staffA[0].id, "2026-10-07"),
    falta(staffA[0].id, "2026-10-08"),
  ]);
  await appendPersonEvents(b.companyId, [
    attendance(movedTo, "2026-10-20"),
    falta(movedTo, "2026-10-21"),
  ]);
  await appendPersonEvents(c.companyId, [
    attendance(cPerson.id, "2026-10-05"),
    falta(cPerson.id, "2026-10-06"),
  ]);
});

describe("lib:reports/group/data/loadGroupReportReader", () => {
  it("lists the companies with reports:read, or every active one for a group admin", async () => {
    const both = await loadGroupReportReader(hr.id);
    const onlyC = await loadGroupReportReader(mixed.id);
    const all = await loadGroupReportReader(groupAdmin.id);

    expect(both.companies.map((row) => row.id).sort()).toEqual(
      [a.companyId, b.companyId].sort(),
    );
    expect(onlyC.companies.map((row) => row.id)).toEqual([c.companyId]);
    expect((await loadGroupReportReader(a.viewer.id)).companies).toEqual([]);
    expect(all.isGroupAdmin).toBe(true);
    expect(all.companies.map((row) => row.id)).toEqual(
      expect.arrayContaining([a.companyId, b.companyId, c.companyId]),
    );
  });
});

describe("lib:reports/group/data/getGroupDashboard", () => {
  it("shows each company exactly as its absenteeism report", async () => {
    const dashboard = await getGroupDashboard(
      await loadGroupReportReader(hr.id),
      filter(),
      TODAY,
    );

    expect(dashboard.companies.map((row) => row.companyId)).toEqual([
      a.companyId,
      b.companyId,
    ]);

    for (const company of dashboard.companies) {
      const own = await getAbsenteeismReport(
        company.companyId,
        absenteeismFilterSchema.parse({ from: FROM, to: TO }),
        TODAY,
      );

      expect(company.report.total.turnover).toEqual(own.total.turnover);
      expect(company.report.total.absenteeism).toEqual(own.total.absenteeism);
      expect(company.report.regions).toEqual(own.regions);
    }

    const [alfa, beta] = dashboard.companies;
    // A counts the quit and the transfer; B counts the arrival as an ingreso.
    expect(alfa.report.total.turnover.exits).toBe(2);
    expect(alfa).toMatchObject({ transfersOut: 1, transfersIn: 0 });
    expect(beta.report.total.turnover.hires).toBe(1);
    expect(beta).toMatchObject({ transfersOut: 0, transfersIn: 1 });
  });

  it("leaves the internal transfer out of the group's bajas and ingresos", async () => {
    const { total, companies } = await getGroupDashboard(
      await loadGroupReportReader(hr.id),
      filter(),
      TODAY,
    );

    expect(total.turnover.exits).toBe(1);
    expect(total.turnover.hires).toBe(0);
    expect(total).toMatchObject({ transfersOut: 1, transfersIn: 1 });
    expect(total.turnover.headcount).toBeCloseTo(
      companies[0].report.total.turnover.headcount +
        companies[1].report.total.turnover.headcount,
      2,
    );
    expect(total.absenteeism).toMatchObject({
      presentDays: 4,
      absentDays: 2,
    });
  });

  it("counts the transfer as a baja when the other company is not in the view", async () => {
    const { total } = await getGroupDashboard(
      await loadGroupReportReader(hr.id),
      filter([a.companyId]),
      TODAY,
    );

    expect(total.turnover.exits).toBe(2);
    expect(total.transfersOut).toBe(0);
  });

  it("never reads a company the reader may not see, even when asked for it", async () => {
    const dashboard = await getGroupDashboard(
      await loadGroupReportReader(hr.id),
      filter([c.companyId]),
      TODAY,
    );
    const onlyC = await getGroupDashboard(
      await loadGroupReportReader(mixed.id),
      filter([a.companyId, c.companyId]),
      TODAY,
    );

    expect(dashboard.companies).toEqual([]);
    expect(dashboard.total.absenteeism.absentDays).toBe(0);
    expect(onlyC.companies.map((row) => row.companyId)).toEqual([c.companyId]);
    expect(JSON.stringify(onlyC)).not.toContain("GRA");
  });
});

describe("lib:reports/group/data/loadCompanyTransfers", () => {
  it("returns each company's own side of a transfer only", async () => {
    const fromA = await loadCompanyTransfers(a.companyId);
    const fromB = await loadCompanyTransfers(b.companyId);
    const fromC = await loadCompanyTransfers(c.companyId);

    expect([...fromA.values()]).toEqual([
      { direction: "out", linkedCompanyId: b.companyId },
    ]);
    expect([...fromB.values()]).toEqual([
      { direction: "in", linkedCompanyId: a.companyId },
    ]);
    expect(fromC.size).toBe(0);
    expect(movedFrom).not.toBe(movedTo);
  });
});

describe("lib:reports/absenteeism/data/loadAbsenteeismInputs", () => {
  it("reads only the company's periods, sucursales and days", async () => {
    const own = await loadAbsenteeismInputs(a.companyId, {
      from: FROM,
      to: TO,
    });
    const other = await loadAbsenteeismInputs(c.companyId, {
      from: FROM,
      to: TO,
    });

    expect(own.facts.map((row) => row.personId)).toContain(movedFrom);
    expect(other.facts.map((row) => row.personId)).not.toContain(movedFrom);
    expect(other.structure.sites.map((row) => row.id)).not.toContain(a.site.id);
    expect(other.absenteeism.map((row) => row.key)).not.toContain(a.site.id);
  });
});

describe("group dashboard export", () => {
  it("route:GET /app/reportes/grupo/exportar", async () => {
    actAs(hr);
    const csv = await exportRoute(new Request(exportUrl("csv")));
    const text = await csv.text();

    expect(csv.status).toBe(200);
    expect(text).toContain("Empresa GRA");
    expect(text).toContain("Empresa GRB");
    expect(text).not.toContain("GRC");
    // No person is named in the file.
    expect(text).not.toContain("Ana");

    const xlsx = await exportRoute(new Request(exportUrl("xlsx")));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await xlsx.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Resumen"]);

    // Audited in each company it includes.
    const audits = await ownerDb
      .select({ companyId: auditEvents.companyId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorUserId, hr.id),
          eq(auditEvents.resourceType, "report_export"),
        ),
      );
    const exported = new Set(audits.map((row) => row.companyId));
    expect(exported.has(a.companyId) && exported.has(b.companyId)).toBe(true);
    expect(exported.has(c.companyId)).toBe(false);

    // Someone who reads only C's reports never gets A in the file.
    actAs(mixed);
    const own = await (
      await exportRoute(
        new Request(exportUrl("csv", `*empresa.${a.companyId}`)),
      )
    ).text();
    expect(own).not.toContain("GRA");
  });

  it("rbac:route:GET /app/reportes/grupo/exportar", async () => {
    // A viewer has no reports:read anywhere; without a session there is no reader.
    for (const user of [a.viewer, null]) {
      actAs(user);
      for (const format of ["csv", "xlsx"]) {
        expect((await exportRoute(new Request(exportUrl(format)))).status).toBe(
          403,
        );
      }
    }
  });
});
