/**
 * Baja y periodos laborales (Iniciativa 2): cross-company isolation of
 * employment periods, motivos de baja and the finiquito; the baja, reingreso
 * and finiquito domain on a real database (contract «Terminado», one open
 * period per person, seniority restart and carry-over, audit with the amount
 * masked); the backfill; and a new alta after a rehire. Test titles are the
 * surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { listAuditEvents } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/db/errors";
import { getSeniorityCertificate } from "@/lib/contracts";
import {
  auditEvents,
  contracts,
  employmentPeriods,
  onboardings,
  people,
  terminationReasons,
} from "@/lib/db/schema";
import { applyJobStep } from "@/lib/import/apply";
import {
  appendImportRows,
  createImportJob,
  finalizeImportUpload,
} from "@/lib/import/jobs";
import { validateJobStep } from "@/lib/import/validate";
import { findBlockingOnboarding, startOnboarding } from "@/lib/onboarding";
import { createPerson, setPersonStatus, updatePerson } from "@/lib/people";
import {
  setPersonStatusAction,
  updateFiniquitoAction,
} from "@/lib/people/actions";
import {
  EmploymentError,
  getEmploymentSummary,
  listEmploymentPeriods,
  listEmploymentSummaries,
  rehirePerson,
  terminatePerson,
  updateFiniquito,
} from "@/lib/people/employment";
import { backfillEmploymentPeriods } from "@/lib/people/employment-backfill";
import { getPersonEmploymentMenuData } from "@/lib/people/employment-menu";
import type { PersonFormValues } from "@/lib/people/schema";
import {
  countUnclassifiedTerminationReasons,
  createTerminationReason,
  ensureTerminationReasons,
  getTerminationReasonById,
  listTerminationReasons,
  listTerminationReasonsWithUsage,
  softDeleteTerminationReason,
  updateTerminationReason,
} from "@/lib/termination-reasons";
import {
  createTerminationReasonAction,
  deleteTerminationReasonAction,
  updateTerminationReasonAction,
} from "@/lib/termination-reasons/actions";
import { TERMINATION_REASON_SEED } from "@/lib/termination-reasons/schema";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let reasonA: typeof terminationReasons.$inferSelect;
let reasonB: typeof terminationReasons.$inferSelect;
/** A person of A given de baja with a finiquito, for the cross-company reads. */
let leftA: typeof people.$inferSelect;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  return "no redirect";
};

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Periodo",
  apellidoPaterno: "Prueba",
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

const baja = (motivoBajaId: string, fechaBaja = "2024-05-31") => ({
  fechaBaja,
  tipoBaja: "voluntaria" as const,
  motivoBajaId,
  comentario: "Cambio de ciudad",
  recontratable: true,
});

const periodsOf = (personId: string) =>
  ownerDb
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.personId, personId))
    .orderBy(employmentPeriods.createdAt);

const personRow = async (id: string) =>
  (await ownerDb.select().from(people).where(eq(people.id, id)))[0];

const reasonRow = async (id: string) =>
  (
    await ownerDb
      .select()
      .from(terminationReasons)
      .where(eq(terminationReasons.id, id))
  )[0];

beforeAll(async () => {
  a = await seedTenant("EA");
  b = await seedTenant("EB");
  reasonA = (await listTerminationReasons(a.companyId))[0];
  reasonB = (await listTerminationReasons(b.companyId))[0];
  leftA = await createPerson(
    a.companyId,
    personForm({ nombres: "Salida" }),
    a.admin.id,
  );
  await terminatePerson(
    a.companyId,
    leftA.id,
    {
      ...baja(reasonA.id),
      finiquito: { estado: "pagado", fecha: "2024-06-15", monto: 15000 },
    },
    a.admin.id,
  );
});

describe("motivos de baja catalog", () => {
  it("seeds the base list once per company, each with its own rows", async () => {
    const names = (await listTerminationReasons(a.companyId)).map(
      (reason) => reason.name,
    );
    expect([...names].sort()).toEqual(
      TERMINATION_REASON_SEED.map((reason) => reason.name).sort(),
    );
    await ensureTerminationReasons(a.companyId);
    expect(await listTerminationReasons(a.companyId)).toHaveLength(
      TERMINATION_REASON_SEED.length,
    );
    expect(reasonA.id).not.toBe(reasonB.id);
  });

  it("renames, deactivates and refuses to delete a motivo in use", async () => {
    const created = await createTerminationReason(
      a.companyId,
      {
        name: "Cierre de sucursal",
        classification: "involuntaria",
        active: true,
      },
      a.admin.id,
    );
    await expect(
      createTerminationReason(
        a.companyId,
        {
          name: "cierre de sucursal",
          classification: "involuntaria",
          active: true,
        },
        a.admin.id,
      ),
    ).rejects.toMatchObject({ name: "DuplicateNameError" });

    const renamed = await updateTerminationReason(
      a.companyId,
      created.id,
      { name: "Cierre de sucursal Norte", active: false },
      a.admin.id,
    );
    expect(renamed).toMatchObject({
      name: "Cierre de sucursal Norte",
      active: false,
    });
    expect(
      (await listTerminationReasons(a.companyId, { activeOnly: true })).map(
        (reason) => reason.id,
      ),
    ).not.toContain(created.id);

    // In use by leftA's baja: deactivate, not delete.
    await expect(
      softDeleteTerminationReason(a.companyId, reasonA.id, a.admin.id),
    ).rejects.toMatchObject({ name: "TerminationReasonInUseError" });
    const usage = await listTerminationReasonsWithUsage(a.companyId);
    expect(usage.find((reason) => reason.id === reasonA.id)?.useCount).toBe(1);

    expect(
      await softDeleteTerminationReason(a.companyId, created.id, a.admin.id),
    ).toMatchObject({ id: created.id });
    expect((await reasonRow(created.id)).deletedAt).not.toBeNull();
  });

  it("classifies reasons: required to create, kept on edit, counted while missing", async () => {
    const seeded = await listTerminationReasons(a.companyId);
    expect(
      seeded.find((reason) => reason.name === "No aprobó el periodo de prueba")
        ?.classification,
    ).toBe("involuntaria");
    expect(seeded.every((reason) => reason.classification !== null)).toBe(true);

    await expect(
      createTerminationReason(
        a.companyId,
        { name: "Sin clasificación", active: true },
        a.admin.id,
      ),
    ).rejects.toMatchObject({ name: "TerminationReasonClassificationError" });

    // A reason from before migration 0027 that nobody classified yet.
    const [legacy] = await ownerDb
      .insert(terminationReasons)
      .values({ companyId: a.companyId, name: "Motivo heredado" })
      .returning();
    expect(await countUnclassifiedTerminationReasons(a.companyId)).toBe(1);
    expect(await countUnclassifiedTerminationReasons(b.companyId)).toBe(0);

    // Editing only its status keeps it sin clasificar; choosing one sticks.
    await updateTerminationReason(
      a.companyId,
      legacy.id,
      { name: legacy.name, active: false },
      a.admin.id,
    );
    expect((await reasonRow(legacy.id)).classification).toBeNull();
    await updateTerminationReason(
      a.companyId,
      legacy.id,
      { name: legacy.name, classification: "voluntaria", active: true },
      a.admin.id,
    );
    expect((await reasonRow(legacy.id)).classification).toBe("voluntaria");
    expect(await countUnclassifiedTerminationReasons(a.companyId)).toBe(0);
    await updateTerminationReason(
      a.companyId,
      legacy.id,
      { name: legacy.name, active: true },
      a.admin.id,
    );
    expect((await reasonRow(legacy.id)).classification).toBe("voluntaria");

    const events = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceType, "termination_reason"),
          eq(auditEvents.resourceId, legacy.id),
        ),
      );
    expect(
      events.some(
        (event) =>
          (event.payload as { changes?: Record<string, unknown> }).changes
            ?.classification,
      ),
    ).toBe(true);
  });
});

describe("employment periods stay inside the company", () => {
  it("lib:termination-reasons/ensureTerminationReasons", async () => {
    await ensureTerminationReasons(b.companyId);
    noLeakOf(await listTerminationReasons(b.companyId));
  });

  it("lib:termination-reasons/countUnclassifiedTerminationReasons", async () => {
    await ownerDb
      .insert(terminationReasons)
      .values({ companyId: a.companyId, name: "Sólo de A sin clasificar" });
    expect(await countUnclassifiedTerminationReasons(b.companyId)).toBe(0);
  });

  it("lib:termination-reasons/listTerminationReasons", async () => {
    noLeakOf(await listTerminationReasons(b.companyId));
  });

  it("lib:termination-reasons/listTerminationReasonsWithUsage", async () => {
    const rows = await listTerminationReasonsWithUsage(b.companyId);
    noLeakOf(rows);
    expect(rows.every((reason) => reason.useCount === 0)).toBe(true);
  });

  it("lib:termination-reasons/getTerminationReasonById", async () => {
    expect(await getTerminationReasonById(b.companyId, reasonA.id)).toBeNull();
  });

  it("lib:termination-reasons/createTerminationReason", async () => {
    const created = await createTerminationReason(
      b.companyId,
      { name: reasonA.name + " B", classification: "otra", active: true },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it("lib:termination-reasons/updateTerminationReason", async () => {
    expect(
      await updateTerminationReason(
        b.companyId,
        reasonA.id,
        { name: "Robado", active: false },
        b.admin.id,
      ),
    ).toBeNull();
    expect((await reasonRow(reasonA.id)).name).toBe(reasonA.name);
  });

  it("lib:termination-reasons/softDeleteTerminationReason", async () => {
    expect(
      await softDeleteTerminationReason(b.companyId, reasonA.id, b.admin.id),
    ).toBeNull();
    expect((await reasonRow(reasonA.id)).deletedAt).toBeNull();
  });

  it("lib:people/employment/listEmploymentPeriods", async () => {
    expect(await listEmploymentPeriods(b.companyId, leftA.id)).toEqual([]);
    expect(await listEmploymentPeriods(a.companyId, leftA.id)).toHaveLength(1);
  });

  it("lib:people/employment/getEmploymentSummary", async () => {
    expect(await getEmploymentSummary(b.companyId, leftA.id)).toBeNull();
  });

  it("lib:people/employment/listEmploymentSummaries", async () => {
    const byIds = await listEmploymentSummaries(b.companyId, [leftA.id]);
    expect(byIds.size).toBe(0);
    noLeakOf([...(await listEmploymentSummaries(b.companyId)).values()]);
  });

  it("lib:people/employment-menu/getPersonEmploymentMenuData", async () => {
    const data = await getPersonEmploymentMenuData(b.companyId, leftA.id, true);
    expect(data.lastBaja).toBeNull();
    noLeakOf(data.reasons);
  });

  it("lib:people/employment/terminatePerson", async () => {
    // B's company on A's person, and A's person with a motivo of B.
    expect(
      await terminatePerson(b.companyId, a.teammate.id, baja(reasonB.id)),
    ).toBeNull();
    await expect(
      terminatePerson(
        a.companyId,
        a.teammate.id,
        baja(reasonB.id, "2026-01-31"),
      ),
    ).rejects.toMatchObject({ field: "motivoBajaId" });
    expect((await personRow(a.teammate.id)).status).toBe("activa");
  });

  it("lib:people/employment/rehirePerson", async () => {
    expect(
      await rehirePerson(b.companyId, leftA.id, {
        fechaIngreso: "2026-01-01",
        reconoceAntiguedad: false,
      }),
    ).toBeNull();
    expect((await personRow(leftA.id)).status).toBe("baja");
  });

  it("lib:people/employment/updateFiniquito", async () => {
    expect(
      await updateFiniquito(b.companyId, leftA.id, {
        estado: "pendiente",
        monto: 1,
      }),
    ).toBeNull();
    expect((await periodsOf(leftA.id))[0]).toMatchObject({
      finiquitoEstado: "pagado",
      finiquitoMonto: "15000.00",
    });
  });

  it("lib:onboarding/findBlockingOnboarding", async () => {
    const [alta] = await ownerDb
      .insert(onboardings)
      .values({ companyId: a.companyId, personId: a.person.id })
      .returning();
    expect(await findBlockingOnboarding(b.companyId, a.person.id)).toBeNull();
    expect(
      await findBlockingOnboarding(a.companyId, a.person.id),
    ).toMatchObject({ id: alta.id });
    await ownerDb.delete(onboardings).where(eq(onboardings.id, alta.id));
  });
});

const noLeakOf = (value: unknown) => {
  const own = new Set([reasonA.id, leftA.id, a.person.id, a.teammate.id]);
  expect(idsIn(value).filter((id) => own.has(id))).toEqual([]);
};

describe("employment actions with company B's session", () => {
  it("action:people/updateFiniquitoAction", async () => {
    actAs(b.admin);
    expect(
      await updateFiniquitoAction(
        leftA.id,
        {},
        formData({ finiquitoEstado: "pendiente", finiquitoMonto: "1" }),
      ),
    ).toEqual({ error: "No encontramos a esta persona." });
    expect((await periodsOf(leftA.id))[0].finiquitoEstado).toBe("pagado");
  });

  it("action:termination-reasons/updateTerminationReasonAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        updateTerminationReasonAction(
          reasonA.id,
          formData({ name: "Robado", active: "true" }),
        ),
      ),
    ).toMatch(/error=not-found/);
    expect((await reasonRow(reasonA.id)).name).toBe(reasonA.name);
  });

  it("action:termination-reasons/deleteTerminationReasonAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() => deleteTerminationReasonAction(reasonA.id)),
    ).toMatch(/error=not-found/);
    expect((await reasonRow(reasonA.id)).deletedAt).toBeNull();
  });

  it("action:termination-reasons/createTerminationReasonAction", async () => {
    actAs(b.admin);
    // A form opened in company A is refused in B's session.
    expect(
      await redirectOf(() =>
        createTerminationReasonAction(
          formData({ name: "Intruso", companyId: a.companyId }),
        ),
      ),
    ).toMatch(/error=company-changed/);
    expect(
      (await listTerminationReasons(a.companyId)).map((reason) => reason.name),
    ).not.toContain("Intruso");
  });
});

describe("employment permissions", () => {
  it.each([
    [
      "rbac:action:termination-reasons/createTerminationReasonAction",
      () => createTerminationReasonAction(formData({ name: "Vista" })),
    ],
    [
      "rbac:action:termination-reasons/updateTerminationReasonAction",
      () =>
        updateTerminationReasonAction(
          reasonB.id,
          formData({ name: "Vista", active: "true" }),
        ),
    ],
    [
      "rbac:action:termination-reasons/deleteTerminationReasonAction",
      () => deleteTerminationReasonAction(reasonB.id),
    ],
  ])("%s", async (_surface, run) => {
    // Editors give bajas (people:update) but do not edit the catalog (settings:update).
    for (const user of [b.viewer, b.editor]) {
      actAs(user);
      expect(await redirectOf(run)).toMatch(
        /error=termination-reasons-forbidden/,
      );
    }
    expect((await reasonRow(reasonB.id)).name).toBe(reasonB.name);
  });

  it("rbac:action:people/updateFiniquitoAction", async () => {
    actAs(a.viewer);
    expect(
      (
        await updateFiniquitoAction(
          leftA.id,
          {},
          formData({ finiquitoEstado: "pendiente" }),
        )
      ).error,
    ).toMatch(/permiso/);

    // An editor updates the estado but never the amount (no compensation:read).
    actAs(a.editor);
    expect(
      await redirectOf(() =>
        updateFiniquitoAction(
          leftA.id,
          {},
          formData({
            finiquitoEstado: "pendiente",
            finiquitoFecha: "2024-06-20",
            finiquitoMonto: "1",
          }),
        ),
      ),
    ).toBe(`/app/personas/${leftA.id}?finiquito=1`);
    expect((await periodsOf(leftA.id))[0]).toMatchObject({
      finiquitoEstado: "pendiente",
      finiquitoFecha: "2024-06-20",
      finiquitoMonto: "15000.00",
    });
  });
});

describe("baja, reingreso and finiquito", () => {
  it("a new person opens a period and a baja closes it with its fields", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Baja" }),
      a.admin.id,
    );
    const [open] = await periodsOf(person.id);
    expect(open).toMatchObject({
      fechaIngreso: "2020-03-01",
      fechaBaja: null,
      fechaAntiguedad: "2020-03-01",
    });

    const [contract] = await ownerDb
      .insert(contracts)
      .values({
        companyId: a.companyId,
        personId: person.id,
        type: "determinado",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        generatedText: "texto",
      })
      .returning();

    await expect(
      terminatePerson(a.companyId, person.id, baja(reasonA.id, "2019-12-31")),
    ).rejects.toMatchObject({ field: "fechaBaja" });

    const result = await setPersonStatus(
      a.companyId,
      person.id,
      { status: "baja", ...baja(reasonA.id) },
      a.admin.id,
    );

    expect(result?.person).toMatchObject({
      status: "baja",
      fechaIngreso: "2020-03-01",
    });
    expect((await periodsOf(person.id))[0]).toMatchObject({
      id: open.id,
      fechaBaja: "2024-05-31",
      tipoBaja: "voluntaria",
      motivoBajaId: reasonA.id,
      comentarioBaja: "Cambio de ciudad",
      recontratable: true,
    });
    const [ended] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(ended).toMatchObject({ status: "terminado", endDate: "2024-05-31" });

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceId, contract.id),
        ),
      );
    expect(events.map((event) => event.action)).toEqual(["terminado"]);

    // Already de baja: refused, nothing changes.
    await expect(
      terminatePerson(a.companyId, person.id, baja(reasonA.id)),
    ).rejects.toBeInstanceOf(EmploymentError);
  });

  it("a reingreso opens a second period: seniority restarts by default", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Reinicio", fechaIngreso: "2018-02-01" }),
      a.admin.id,
    );
    await terminatePerson(
      a.companyId,
      person.id,
      { ...baja(reasonA.id, "2023-06-30"), recontratable: false },
      a.admin.id,
    );

    await expect(
      rehirePerson(a.companyId, person.id, {
        fechaIngreso: "2023-06-30",
        reconoceAntiguedad: false,
      }),
    ).rejects.toMatchObject({ field: "fechaIngreso" });

    const result = await rehirePerson(
      a.companyId,
      person.id,
      { fechaIngreso: "2025-01-15", reconoceAntiguedad: false },
      a.admin.id,
    );

    expect(result?.warnings.join(" ")).toMatch(/no recontratable/);
    expect(await personRow(person.id)).toMatchObject({
      status: "activa",
      fechaIngreso: "2025-01-15",
    });
    const periods = await periodsOf(person.id);
    expect(periods).toHaveLength(2);
    expect(periods[0].fechaBaja).toBe("2023-06-30");
    expect(periods[1]).toMatchObject({
      fechaIngreso: "2025-01-15",
      fechaBaja: null,
      reconoceAntiguedad: false,
      fechaAntiguedad: "2025-01-15",
    });
    expect(await getEmploymentSummary(a.companyId, person.id)).toMatchObject({
      abierto: true,
      periodCount: 2,
      fechaAntiguedad: "2025-01-15",
    });

    const certificate = await getSeniorityCertificate(
      a.companyId,
      person.id,
      "2026-01-15",
    );
    expect(certificate).toMatchObject({
      fechaIngreso: "2025-01-15",
      fechaAntiguedad: "2025-01-15",
      antiguedad: "1 año",
    });

    // The history keeps both: the baja and the reingreso.
    const history = await listAuditEvents({
      companyId: a.companyId,
      resourceType: "person",
      resourceId: person.id,
    });
    expect(history.map((event) => event.action)).toEqual(
      expect.arrayContaining(["create", "baja", "reingreso"]),
    );
  });

  it("with «Reconocer antigüedad previa» seniority carries over", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Acumula", fechaIngreso: "2018-02-01" }),
      a.admin.id,
    );
    await terminatePerson(
      a.companyId,
      person.id,
      baja(reasonA.id, "2023-06-30"),
      a.admin.id,
    );
    await rehirePerson(
      a.companyId,
      person.id,
      { fechaIngreso: "2025-01-15", reconoceAntiguedad: true },
      a.admin.id,
    );

    expect(await getEmploymentSummary(a.companyId, person.id)).toMatchObject({
      fechaIngreso: "2025-01-15",
      fechaAntiguedad: "2018-02-01",
      reconoceAntiguedad: true,
    });
    const certificate = await getSeniorityCertificate(
      a.companyId,
      person.id,
      "2026-02-01",
    );
    expect(certificate).toMatchObject({
      fechaAntiguedad: "2018-02-01",
      antiguedad: "8 años",
    });
    expect(certificate?.text).toMatch(/antigüedad reconocida desde/);
  });

  it("allows only one open period per person, even racing", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Carrera" }),
      a.admin.id,
    );

    // The partial unique index refuses a second open period.
    await expect(
      ownerDb.insert(employmentPeriods).values({
        companyId: a.companyId,
        personId: person.id,
        fechaIngreso: "2021-01-01",
      }),
    ).rejects.toSatisfy(isUniqueViolation);

    await terminatePerson(a.companyId, person.id, baja(reasonA.id));
    const results = await Promise.allSettled([
      rehirePerson(a.companyId, person.id, {
        fechaIngreso: "2025-02-01",
        reconoceAntiguedad: false,
      }),
      rehirePerson(a.companyId, person.id, {
        fechaIngreso: "2025-02-02",
        reconoceAntiguedad: false,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await periodsOf(person.id)).filter(
        (period) => period.fechaBaja === null,
      ),
    ).toHaveLength(1);
  });

  it("an edited ingreso moves the current period", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Edita" }),
      a.admin.id,
    );
    await updatePerson(
      a.companyId,
      person.id,
      personForm({ nombres: "Edita", fechaIngreso: "2020-04-15" }),
      a.admin.id,
    );
    expect((await periodsOf(person.id))[0]).toMatchObject({
      fechaIngreso: "2020-04-15",
      fechaAntiguedad: "2020-04-15",
    });
  });

  it("masks the finiquito amount in Historial without compensation:read", async () => {
    await updateFiniquito(
      a.companyId,
      leftA.id,
      { estado: "pagado", fecha: "2024-06-30", monto: 18000 },
      a.admin.id,
    );
    const history = (compensation: boolean) =>
      listAuditEvents({
        companyId: a.companyId,
        resourceType: "person",
        resourceId: leftA.id,
        action: "finiquito_actualizado",
        compensation,
      });

    const [masked] = await history(false);
    expect(masked.payload?.changes?.finiquitoMonto).toEqual({
      from: "•••",
      to: "•••",
    });
    expect(JSON.stringify(masked.payload)).not.toContain("18000");
    const [clear] = await history(true);
    expect(clear.payload?.changes?.finiquitoMonto).toEqual({
      from: "15000.00",
      to: "18000.00",
    });

    const [bajaEvent] = await listAuditEvents({
      companyId: a.companyId,
      resourceType: "person",
      resourceId: leftA.id,
      action: "baja",
    });
    expect(bajaEvent.payload?.changes?.finiquitoMonto?.to).toBe("•••");
    expect(bajaEvent.payload?.summary).not.toMatch(/15/);

    const menu = await getPersonEmploymentMenuData(
      a.companyId,
      leftA.id,
      false,
    );
    expect(menu.lastBaja).toMatchObject({
      finiquitoMonto: null,
      hasFiniquitoMonto: true,
    });
    expect(
      (await getPersonEmploymentMenuData(a.companyId, leftA.id, true)).lastBaja
        ?.finiquitoMonto,
    ).toBe("18000.00");
  });

  it("the dialogs' action needs every baja field and records it", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Accion" }),
      a.admin.id,
    );
    actAs(a.admin);

    const missing = await setPersonStatusAction(
      person.id,
      "baja",
      {},
      formData({ fechaBaja: "2024-05-31", tipoBaja: "despido" }),
    );
    expect(Object.keys(missing.fieldErrors ?? {}).sort()).toEqual([
      "motivoBajaId",
      "recontratable",
    ]);

    expect(
      await redirectOf(() =>
        setPersonStatusAction(
          person.id,
          "baja",
          {},
          formData({
            fechaBaja: "2024-05-31",
            tipoBaja: "despido",
            motivoBajaId: reasonA.id,
            recontratable: "no",
            finiquitoEstado: "pendiente",
          }),
        ),
      ),
    ).toBe(`/app/personas/${person.id}?baja=1`);
    expect((await periodsOf(person.id))[0]).toMatchObject({
      tipoBaja: "despido",
      recontratable: false,
      finiquitoEstado: "pendiente",
    });

    expect(
      await redirectOf(() =>
        setPersonStatusAction(
          person.id,
          "activa",
          {},
          formData({ fechaIngreso: "2025-03-01", reconoceAntiguedad: "si" }),
        ),
      ),
    ).toBe(`/app/personas/${person.id}?reingreso=1`);
    expect((await periodsOf(person.id))[1]).toMatchObject({
      fechaIngreso: "2025-03-01",
      reconoceAntiguedad: true,
      fechaAntiguedad: "2020-03-01",
    });
  });

  it("a rehired person can get a new alta for the new period", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Alta" }),
      a.admin.id,
    );
    const first = await startOnboarding(a.companyId, person.id, a.admin.id);
    await ownerDb
      .update(onboardings)
      .set({ stage: "completo" })
      .where(eq(onboardings.id, first.id));
    await expect(
      startOnboarding(a.companyId, person.id, a.admin.id),
    ).rejects.toThrow("Esta persona ya tiene un alta.");

    await terminatePerson(a.companyId, person.id, baja(reasonA.id));
    await rehirePerson(a.companyId, person.id, {
      fechaIngreso: "2025-01-01",
      reconoceAntiguedad: false,
    });

    const second = await startOnboarding(a.companyId, person.id, a.admin.id);
    const periods = await periodsOf(person.id);
    expect(first.employmentPeriodId).toBe(periods[0].id);
    expect(second.employmentPeriodId).toBe(periods[1].id);
  });
});

describe("importing people (Iniciativa 2 hook)", () => {
  it("opens a period for each new person and closes it when a row says baja", async () => {
    const job = await createImportJob(
      a.companyId,
      {
        fileName: "periodos.xlsx",
        fileHash: "periodos",
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
          cells: {
            nombres: "Importada",
            apellidoPaterno: "Activa",
            fechaIngreso: "2024-02-01",
          },
        },
        {
          rowNumber: 3,
          cells: {
            nombres: "Importada",
            apellidoPaterno: "Baja",
            fechaIngreso: "2020-02-01",
            estatus: "Baja",
            // A baja always carries its data (WRK-I12).
            fechaBaja: "2024-05-31",
            tipoBaja: "Voluntaria",
            motivoBaja: reasonA.name,
            recontratable: "Sí",
          },
        },
      ],
    });
    await finalizeImportUpload(a.companyId, job.id, 2);

    let step;
    do {
      step = await validateJobStep(a.companyId, job.id);
    } while (!step.done);
    let applied;
    do {
      applied = await applyJobStep(a.companyId, job.id);
    } while (!applied.done);

    const imported = await ownerDb
      .select()
      .from(people)
      .where(
        and(eq(people.companyId, a.companyId), eq(people.nombres, "Importada")),
      );
    const byName = new Map(
      imported.map((person) => [person.apellidoPaterno, person]),
    );
    expect((await periodsOf(byName.get("Activa")!.id))[0]).toMatchObject({
      fechaIngreso: "2024-02-01",
      fechaBaja: null,
      bajaSinFecha: false,
    });
    expect(byName.get("Baja")!.status).toBe("baja");
    expect((await periodsOf(byName.get("Baja")!.id))[0]).toMatchObject({
      fechaIngreso: "2020-02-01",
      fechaBaja: "2024-05-31",
      motivoBajaId: reasonA.id,
      bajaSinFecha: false,
    });
  });
});

describe("backfill of employment periods", () => {
  it("infers the baja from the audit log, the last contract or leaves it for review, once", async () => {
    const c = await seedTenant("EC");
    const insertPerson = async (values: Partial<typeof people.$inferInsert>) =>
      (
        await ownerDb
          .insert(people)
          .values({
            companyId: c.companyId,
            nombres: "Histórica",
            apellidoPaterno: "Backfill",
            ...values,
          })
          .returning()
      )[0];
    const fromAudit = await insertPerson({
      status: "baja",
      fechaIngreso: "2019-01-01",
    });
    const fromContract = await insertPerson({
      status: "baja",
      fechaIngreso: "2019-01-01",
    });
    const sinFecha = await insertPerson({ status: "baja" });
    await ownerDb.insert(auditEvents).values({
      companyId: c.companyId,
      resourceType: "person",
      resourceId: fromAudit.id,
      action: "baja",
      occurredAt: new Date("2024-03-10T18:00:00Z"),
    });
    await ownerDb.insert(contracts).values({
      companyId: c.companyId,
      personId: fromContract.id,
      type: "determinado",
      startDate: "2023-01-01",
      endDate: "2023-12-31",
      status: "vencido",
      generatedText: "texto",
    });
    const [legacyAlta] = await ownerDb
      .insert(onboardings)
      .values({ companyId: c.companyId, personId: c.person.id })
      .returning();

    // Fixture people: c.person and c.teammate, activa without ingreso.
    const dryRun = await backfillEmploymentPeriods({ companyId: c.companyId });
    expect(dryRun).toMatchObject({
      people: 5,
      open: 2,
      closedFromAudit: 1,
      closedFromContract: 1,
      closedSinFecha: 1,
      sinIngreso: 3,
      applied: false,
    });
    expect(await periodsOf(fromAudit.id)).toEqual([]);

    const applied = await backfillEmploymentPeriods({
      companyId: c.companyId,
      apply: true,
    });
    expect(applied).toMatchObject({
      people: 5,
      onboardingsLinked: 1,
      applied: true,
    });
    expect((await periodsOf(fromAudit.id))[0]).toMatchObject({
      fechaBaja: "2024-03-10",
      fechaBajaInferida: true,
      requiereRevision: false,
    });
    expect((await periodsOf(fromContract.id))[0]).toMatchObject({
      fechaBaja: "2023-12-31",
      fechaBajaInferida: true,
    });
    expect((await periodsOf(sinFecha.id))[0]).toMatchObject({
      fechaBaja: null,
      bajaSinFecha: true,
      requiereRevision: true,
    });
    expect((await periodsOf(c.person.id))[0]).toMatchObject({
      fechaBaja: null,
      bajaSinFecha: false,
      requiereRevision: true,
    });
    const [linked] = await ownerDb
      .select()
      .from(onboardings)
      .where(eq(onboardings.id, legacyAlta.id));
    expect(linked.employmentPeriodId).toBe(
      (await periodsOf(c.person.id))[0].id,
    );

    // Idempotent: a second run finds nobody without a period.
    expect(
      await backfillEmploymentPeriods({ companyId: c.companyId, apply: true }),
    ).toMatchObject({ people: 0 });
  });
});
