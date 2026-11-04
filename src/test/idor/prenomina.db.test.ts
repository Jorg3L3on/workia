/**
 * Pre-nómina (Workia 2.0 W2-18) against the database: the close snapshot
 * keeps what justified each incidencia, the summary and the file read only
 * that snapshot (a write after the close does not reach them until a reopen),
 * an open quincena cannot be exported, every file leaves an audit event, and
 * company B can neither read nor change company A's templates or
 * pre-nómina. Titles are the surface ids in docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as prenominaRoute } from "@/app/app/periodos/[period]/prenomina/route";
import { auditEvents, incidenciasPeriodSnapshot } from "@/lib/db/schema";
import {
  closePayPeriod,
  PayPeriodError,
  reopenPayPeriod,
  verifyPeriodSnapshot,
} from "@/lib/pay-periods";
import {
  archivePrenominaTemplate,
  createPrenominaTemplate,
  exportPrenomina,
  getPrenominaOverview,
  getPrenominaTemplate,
  listPrenominaTemplates,
  PrenominaError,
  updatePrenominaTemplate,
} from "@/lib/prenomina";
import {
  archivePrenominaTemplateAction,
  savePrenominaTemplateAction,
} from "@/lib/prenomina/actions";
import { PRENOMINA_COPY } from "@/lib/prenomina/copy";
import type { PrenominaTemplateInput } from "@/lib/prenomina/template";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { replacePeriodIncidencias } from "@/lib/timeline/writers";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) data.set(key, value);

  return data;
};

let a: Tenant;
let b: Tenant;

const Q = "2027-05-Q1";

const longCsv: PrenominaTemplateInput = {
  name: "Proveedor CSV",
  format: "csv",
  layout: "long",
  delimiter: ";",
  encoding: "utf8",
  dateFormat: "dmy",
  includeHeader: true,
  skipEmpty: true,
  columns: [
    { header: "CURP", field: "curp" },
    { header: "PERIODO", field: "numero_periodo" },
    { header: "CONCEPTO", field: "concepto" },
    { header: "VALOR", field: "cantidad" },
    { header: "INICIO", field: "fecha_inicio" },
  ],
  conceptCodes: {
    faltas: "F01",
    vacaciones: "V01",
    incapacidades: "I01",
    permisos_con_goce: "P01",
    retardos: "R01",
  },
};

const routeRequest = (period: string, template?: string) =>
  prenominaRoute(
    new Request(
      `http://test/app/periodos/${period}/prenomina${template ? `?plantilla=${template}` : ""}`,
    ),
    { params: Promise.resolve({ period }) },
  );

const exportEvents = (companyId: string) =>
  ownerDb
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.companyId, companyId),
        eq(auditEvents.resourceType, "prenomina_export"),
      ),
    );

/** Company A's quincena: Ana with a falta, a vacation, an incapacidad and two retardos (one justified); Tere with a permiso and an HR override. */
const writeIncidencias = (tenant: Tenant) =>
  replacePeriodIncidencias(tenant.companyId, {
    period: Q,
    personIds: [tenant.person.id, tenant.teammate.id],
    incidencias: [
      {
        personId: tenant.person.id,
        day: "2027-05-03",
        kind: "falta",
        source: "engine",
      },
      {
        personId: tenant.person.id,
        day: "2027-05-04",
        kind: "falta",
        justified: true,
        justificationRef: "vacation:v1",
        source: "engine",
      },
      {
        personId: tenant.person.id,
        day: "2027-05-05",
        kind: "falta",
        justified: true,
        justificationRef: "incapacidad_imss:j1",
        source: "engine",
      },
      {
        personId: tenant.person.id,
        day: "2027-05-06",
        kind: "retardo",
        minutes: 12,
        source: "engine",
      },
      {
        personId: tenant.person.id,
        day: "2027-05-07",
        kind: "retardo",
        minutes: 30,
        justified: true,
        justificationRef: "override:o1",
        source: "engine",
      },
      {
        personId: tenant.teammate.id,
        day: "2027-05-03",
        kind: "falta",
        justified: true,
        justificationRef: "permiso_con_goce:j2",
        source: "engine",
      },
      {
        personId: tenant.teammate.id,
        day: "2027-05-04",
        kind: "falta",
        justified: true,
        justificationRef: "override:o2",
        source: "engine",
      },
    ],
  });

beforeAll(async () => {
  a = await seedTenant("PNA");
  b = await seedTenant("PNB");
  await writeIncidencias(a);
  await writeIncidencias(b);
});

describe("the close snapshot keeps what justified each incidencia (0052)", () => {
  it("freezes the justified ones by source and the justified minutes", async () => {
    await closePayPeriod(a.companyId, Q, { actorUserId: a.admin.id });
    const rows = await ownerDb
      .select()
      .from(incidenciasPeriodSnapshot)
      .where(eq(incidenciasPeriodSnapshot.companyId, a.companyId));
    const of = (personId: string, kind: string) =>
      rows.find((row) => row.personId === personId && row.kind === kind);

    expect(of(a.person.id, "falta")).toMatchObject({
      count: 3,
      justified: 2,
      justifiedVacation: 1,
      justifiedIncapacidad: 1,
      justifiedPermisoConGoce: 0,
    });
    expect(of(a.person.id, "retardo")).toMatchObject({
      count: 2,
      justified: 1,
      minutes: 42,
      justifiedMinutes: 30,
    });
    expect(of(a.teammate.id, "falta")).toMatchObject({
      count: 2,
      justified: 2,
      justifiedPermisoConGoce: 1,
    });
    expect((await verifyPeriodSnapshot(a.companyId, Q))?.matches).toBe(true);
  });
});

describe("lib:prenomina/getPrenominaOverview", () => {
  it("adds up the company's closed quincena and checks every template", async () => {
    const overview = await getPrenominaOverview(a.companyId, Q);

    expect(overview?.people).toBe(2);
    expect(overview?.totals).toMatchObject({
      faltas: 1,
      vacaciones: 1,
      incapacidades: 1,
      permisos_con_goce: 1,
      faltas_justificadas_rh: 1,
      retardos: 1,
      minutos_retardo: 12,
    });
    expect(overview?.templates[0]).toMatchObject({
      id: "workia",
      rows: 2,
      people: 2,
      // Tere has neither RFC nor NSS: the provider would reject her rows.
      missing: [
        { field: "rfc", people: 1 },
        { field: "nss", people: 1 },
      ],
    });
  });

  it("is null while the quincena is open, and for another company's", async () => {
    expect(await getPrenominaOverview(a.companyId, "2027-05-Q2")).toBeNull();
    // B's quincena is still open: A's close says nothing about it.
    expect(await getPrenominaOverview(b.companyId, Q)).toBeNull();
  });
});

describe("lib:prenomina/createPrenominaTemplate", () => {
  it("stores a template in the company and leaves an audit event", async () => {
    const template = await createPrenominaTemplate(a.companyId, longCsv, {
      actorUserId: a.admin.id,
    });

    expect(template).toMatchObject({ name: "Proveedor CSV", builtIn: false });
    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceType, "prenomina_template"),
          eq(auditEvents.resourceId, template.id),
        ),
      );
    expect(event.action).toBe("create");
  });

  it("refuses an invalid template and a duplicate name", async () => {
    await expect(
      createPrenominaTemplate(a.companyId, { ...longCsv, conceptCodes: {} }),
    ).rejects.toMatchObject({ code: "invalid_template" });
    await expect(
      createPrenominaTemplate(a.companyId, {
        ...longCsv,
        name: "proveedor csv",
      }),
    ).rejects.toMatchObject({ code: "duplicate_name" });
    // The same name is fine in another company.
    await expect(
      createPrenominaTemplate(b.companyId, longCsv),
    ).resolves.toMatchObject({ name: "Proveedor CSV" });
  });
});

describe("lib:prenomina/listPrenominaTemplates", () => {
  it("lists the built-in template and only the company's own", async () => {
    const own = await listPrenominaTemplates(a.companyId);
    const other = await listPrenominaTemplates(b.companyId);
    const ownIds = own.map((template) => template.id);

    expect(own[0].id).toBe("workia");
    expect(
      other.some(
        (template) => ownIds.includes(template.id) && !template.builtIn,
      ),
    ).toBe(false);
  });
});

describe("lib:prenomina/getPrenominaTemplate", () => {
  it("returns null for another company's template", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    expect(await getPrenominaTemplate(a.companyId, mine.id)).not.toBeNull();
    expect(await getPrenominaTemplate(b.companyId, mine.id)).toBeNull();
    expect(await getPrenominaTemplate(b.companyId, "not-a-uuid")).toBeNull();
  });
});

describe("lib:prenomina/updatePrenominaTemplate", () => {
  it("changes the company's template and not another company's", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    expect(
      await updatePrenominaTemplate(b.companyId, mine.id, {
        ...longCsv,
        name: "Intrusa",
      }),
    ).toBeNull();
    expect((await getPrenominaTemplate(a.companyId, mine.id))?.name).toBe(
      "Proveedor CSV",
    );

    const updated = await updatePrenominaTemplate(
      a.companyId,
      mine.id,
      { ...longCsv, delimiter: "|" },
      { actorUserId: a.admin.id },
    );
    expect(updated?.delimiter).toBe("|");
    await updatePrenominaTemplate(a.companyId, mine.id, longCsv);
  });
});

describe("lib:prenomina/exportPrenomina", () => {
  it("builds the file from the snapshot and records its hash", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);
    const file = await exportPrenomina(a.companyId, Q, mine.id, {
      actorUserId: a.admin.id,
      companySlug: "pna",
    });
    const lines = file.body.toString("utf8").trim().split("\r\n");

    expect(file.fileName).toBe(`prenomina-pna-${Q}-r1-proveedor-csv.csv`);
    expect(lines[0]).toBe("CURP;PERIODO;CONCEPTO;VALOR;INICIO");
    // Ana: falta, retardo, incapacidad, vacation; Tere: permiso. Override rows are not mapped.
    expect(lines).toHaveLength(6);
    expect(lines).toContain(`${a.person.curp};9;F01;1;01/05/2027`);
    expect(lines).toContain(`${a.person.curp};9;R01;1;01/05/2027`);
    expect(lines).toContain(`${a.teammate.curp};9;P01;1;01/05/2027`);

    const [event] = (await exportEvents(a.companyId)).filter(
      (row) =>
        (row.payload as { after?: { sha256?: string } }).after?.sha256 ===
        file.sha256,
    );
    expect(event).toMatchObject({ action: "export", actorUserId: a.admin.id });
  });

  it("a write after the close does not change the file; a reopen and a new close do", async () => {
    const before = await exportPrenomina(a.companyId, Q, "workia");

    // The engine's writer refuses a closed quincena.
    await expect(writeIncidencias(a)).rejects.toBeInstanceOf(PayPeriodError);
    expect((await exportPrenomina(a.companyId, Q, "workia")).rows).toBe(
      before.rows,
    );

    await reopenPayPeriod(a.companyId, Q, {
      reason: "Faltó una falta",
      actorUserId: a.admin.id,
    });
    await expect(
      exportPrenomina(a.companyId, Q, "workia"),
    ).rejects.toMatchObject({ code: "period_open" });
    const [reopen] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceType, "pay_period"),
          eq(auditEvents.action, "reopen"),
        ),
      );
    expect(reopen).toBeDefined();

    await closePayPeriod(a.companyId, Q, { actorUserId: a.admin.id });
    const after = await exportPrenomina(a.companyId, Q, "workia", {
      companySlug: "pna",
    });
    expect(after.fileName).toContain("-r2-");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(after.body as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe("CURP");
    expect(sheet.rowCount).toBe(3);
  });

  it("refuses another company's template and an open quincena", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    await expect(
      exportPrenomina(b.companyId, Q, mine.id),
    ).rejects.toBeInstanceOf(PrenominaError);
    await expect(
      exportPrenomina(b.companyId, Q, "workia"),
    ).rejects.toMatchObject({
      code: "period_open",
    });
  });
});

describe("route:GET /app/periodos/[period]/prenomina", () => {
  it("gives the session's company file, never another company's", async () => {
    // B closes its own quincena: A's people must not be in B's file.
    await closePayPeriod(b.companyId, Q, { actorUserId: b.admin.id });
    actAs(b.admin);
    const response = await routeRequest(Q);
    const body = Buffer.from(await response.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    const values = JSON.stringify(workbook.worksheets[0].getSheetValues());

    expect(response.status).toBe(200);
    expect(values).toContain(b.person.nombres);
    expect(values).not.toContain(a.person.nombres);
    expect(response.headers.get("Content-Disposition")).toContain(
      b.company.slug,
    );
  });

  it("is 404 for another company's template and 409 for an open quincena", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    actAs(b.admin);
    expect((await routeRequest(Q, mine.id)).status).toBe(404);
    expect((await routeRequest("2027-06-Q1")).status).toBe(409);
    expect((await routeRequest("2027-6-1")).status).toBe(404);
  });
});

describe("action:prenomina/savePrenominaTemplateAction", () => {
  it("never writes into another company", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    actAs(b.admin);
    expect(
      await savePrenominaTemplateAction(
        {},
        formData({
          id: mine.id,
          template: JSON.stringify({ ...longCsv, name: "Intrusa" }),
        }),
      ),
    ).toEqual({ error: PRENOMINA_COPY.notFound });
    expect(
      await savePrenominaTemplateAction(
        {},
        formData({
          companyId: a.companyId,
          template: JSON.stringify({ ...longCsv, name: "Intrusa" }),
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect((await getPrenominaTemplate(a.companyId, mine.id))?.name).toBe(
      "Proveedor CSV",
    );
    expect(
      (await listPrenominaTemplates(a.companyId)).map((item) => item.name),
    ).not.toContain("Intrusa");
  });

  it("creates in the session's company", async () => {
    actAs(b.admin);
    const result = await savePrenominaTemplateAction(
      {},
      formData({ template: JSON.stringify({ ...longCsv, name: "Otra de B" }) }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(await getPrenominaTemplate(b.companyId, result.id!)).not.toBeNull();
  });
});

describe("action:prenomina/archivePrenominaTemplateAction", () => {
  it("cannot archive another company's template", async () => {
    const [, mine] = await listPrenominaTemplates(a.companyId);

    actAs(b.admin);
    expect(
      await archivePrenominaTemplateAction({}, formData({ id: mine.id })),
    ).toEqual({ error: PRENOMINA_COPY.notFound });
    expect(await getPrenominaTemplate(a.companyId, mine.id)).not.toBeNull();
  });
});

describe("lib:prenomina/archivePrenominaTemplate", () => {
  it("archives only the company's own template, which then disappears", async () => {
    const created = await createPrenominaTemplate(a.companyId, {
      ...longCsv,
      name: "Para archivar",
    });

    expect(await archivePrenominaTemplate(b.companyId, created.id)).toBe(false);
    expect(await archivePrenominaTemplate(a.companyId, created.id)).toBe(true);
    expect(await getPrenominaTemplate(a.companyId, created.id)).toBeNull();
    // Archived names can be used again.
    await expect(
      createPrenominaTemplate(a.companyId, {
        ...longCsv,
        name: "Para archivar",
      }),
    ).resolves.toMatchObject({ name: "Para archivar" });
  });
});

describe("pre-nómina permissions", () => {
  it("rbac:route:GET /app/periodos/[period]/prenomina", async () => {
    // Viewers have neither pay_periods:read nor people:export.
    actAs(b.viewer);
    expect((await routeRequest(Q)).status).toBe(403);
  });

  it("rbac:action:prenomina/savePrenominaTemplateAction", async () => {
    actAs(b.viewer);
    expect(
      await savePrenominaTemplateAction(
        {},
        formData({
          template: JSON.stringify({ ...longCsv, name: "Sin permiso" }),
        }),
      ),
    ).toEqual({ error: PRENOMINA_COPY.denied });
  });

  it("rbac:action:prenomina/archivePrenominaTemplateAction", async () => {
    const [, mine] = await listPrenominaTemplates(b.companyId);

    actAs(b.viewer);
    expect(
      await archivePrenominaTemplateAction({}, formData({ id: mine.id })),
    ).toEqual({ error: PRENOMINA_COPY.denied });
    expect(await getPrenominaTemplate(b.companyId, mine.id)).not.toBeNull();
  });
});
