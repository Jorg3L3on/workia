/**
 * Self-service onboarding (Workia 2.0 W2-10) on a real database. HR of
 * company B cannot open, read, apply or return company A's form; a role
 * without people:update is denied, and giving access needs
 * employee_accounts:manage. The employee fills only their own form, after the
 * privacy notice; what they send waits for HR, which applies it to the
 * expediente (at least 80 percent of the fields from the person) before the
 * alta's HR approval. Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const employee = vi.hoisted(() => ({
  current: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
  sent: [] as { to: string; subject: string; text: string }[],
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...original,
    requestOrigin: async () => "https://workia.test",
    getEmployeeContext: async () => employee.current,
    requireEmployeeContext: async () => {
      if (!employee.current)
        throw new NavigationThrow("redirect", "/mi/entrar");
      return employee.current;
    },
  };
});

vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    employee.sent.push(message);
  },
}));

import {
  auditEvents,
  employeeAccounts,
  notifications,
  onboardingIntakes,
  people,
} from "@/lib/db/schema";
import {
  approveOnboardingStep,
  startOnboarding,
  updateOnboarding,
} from "@/lib/onboarding";
import { saveEmployeeIntakeAction } from "@/lib/onboarding/employee-actions";
import {
  applyIntake,
  getEmployeeIntake,
  getIntakeForOnboarding,
  intakeBlocksHrApproval,
  openSelfService,
  returnIntake,
} from "@/lib/onboarding/intake";
import {
  applyIntakeAction,
  openSelfServiceAction,
  returnIntakeAction,
} from "@/lib/onboarding/intake-actions";
import { INTAKE_COPY } from "@/lib/onboarding/intake-schema";
import { sampleCurp } from "@/lib/people/identity";
import { ONBOARDING_CHECKLIST } from "@/lib/onboarding/schema";
import { publishPrivacyNotice, recordPrivacyAcceptance } from "@/lib/privacy";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let altaA: string;
let altaB: string;
let altaTeammateA: string;
let noticeA: string;
const ctx = {} as Record<"a" | "b", NonNullable<typeof employee.current>>;

const FORM = {
  telefono: "55 1234 5678",
  fechaNacimiento: "1995-04-12",
  sexo: "M",
  estadoCivil: "soltero",
  lugarNacimiento: "Jalisco",
  nacionalidad: "Mexicana",
  rfc: "GOMA950412AB1",
  nss: "12345678903",
  ineClaveElector: "GOMRAN95041214M100",
  domicilioCalle: "Av. Juárez",
  domicilioNumeroExterior: "120",
  domicilioColonia: "Centro",
  domicilioMunicipio: "Guadalajara",
  domicilioEstado: "Jalisco",
  domicilioCodigoPostal: "44100",
};

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

const intakeOf = async (onboardingId: string) =>
  (
    await ownerDb
      .select()
      .from(onboardingIntakes)
      .where(eq(onboardingIntakes.onboardingId, onboardingId))
  )[0];

const account = async (tenant: Tenant) => {
  const [row] = await ownerDb
    .insert(employeeAccounts)
    .values({
      companyId: tenant.companyId,
      personId: tenant.person.id,
      status: "active",
      email: `alta.${tenant.label.toLowerCase()}@empleo.test`,
      activatedAt: new Date(),
    })
    .returning();
  return {
    accountId: row!.id,
    companyId: tenant.companyId,
    personId: tenant.person.id,
    sessionId: "test",
  };
};

const FULL = Object.fromEntries(
  ONBOARDING_CHECKLIST.map((item) => [item, true]),
) as Record<(typeof ONBOARDING_CHECKLIST)[number], boolean>;

beforeAll(async () => {
  a = await seedTenant("IA");
  b = await seedTenant("IB");
  altaA = (await startOnboarding(a.companyId, a.person.id, a.admin.id)).id;
  altaB = (await startOnboarding(b.companyId, b.person.id, b.admin.id)).id;
  // A CURP no other test file uses: one live employee account per CURP
  // across companies, and the shared fixtures reuse theirs.
  await ownerDb
    .update(people)
    .set({ curp: sampleCurp(4801) })
    .where(eq(people.id, a.teammate.id));
  altaTeammateA = (
    await startOnboarding(a.companyId, a.teammate.id, a.admin.id)
  ).id;
  const published = await publishPrivacyNotice(
    a.companyId,
    { body: "Aviso de privacidad de A." },
    a.admin.id,
  );
  if (!published.ok) throw new Error(published.error);
  noticeA = published.value.id;
  ctx.a = await account(a);
  ctx.b = await account(b);
});

describe("HR opens self-service only on its own altas", () => {
  it("lib:onboarding/intake/openSelfService", async () => {
    expect(await openSelfService(b.companyId, altaA, b.admin.id)).toEqual({
      ok: false,
      error: "Alta no encontrada.",
    });
    expect(await intakeOf(altaA)).toBeUndefined();
  });

  it("action:onboarding/openSelfServiceAction", async () => {
    actAs(b.admin);
    expect(
      await openSelfServiceAction(
        altaA,
        {},
        formData({ companyId: b.companyId }),
      ),
    ).toEqual({ error: "Alta no encontrada." });
    // A's company id from B's session is refused before anything.
    expect(
      await openSelfServiceAction(
        altaA,
        {},
        formData({ companyId: a.companyId }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await intakeOf(altaA)).toBeUndefined();
  });

  it("rbac:action:onboarding/openSelfServiceAction", async () => {
    actAs(a.viewer);
    expect(
      (
        await openSelfServiceAction(
          altaA,
          {},
          formData({ companyId: a.companyId }),
        )
      ).error,
    ).toMatch(/permiso/);
    expect(await intakeOf(altaA)).toBeUndefined();

    // The editor has people:update but cannot create employee access.
    actAs(a.editor);
    expect(
      (
        await openSelfServiceAction(
          altaTeammateA,
          {},
          formData({ companyId: a.companyId, modo: "codigo" }),
        )
      ).error,
    ).toMatch(/cuentas de empleado/);
    expect(await intakeOf(altaTeammateA)).toBeUndefined();
  });

  it("opens with a reminder for an active account and an activation code otherwise", async () => {
    actAs(a.admin);
    const reminded = await openSelfServiceAction(
      altaA,
      {},
      formData({ companyId: a.companyId }),
    );
    expect(reminded.notice).toMatch(/alta\.ia@empleo\.test/);
    expect(employee.sent.at(-1)).toMatchObject({
      to: "alta.ia@empleo.test",
      subject: "Completa tu alta en Workia",
    });
    expect(await intakeOf(altaA)).toMatchObject({
      companyId: a.companyId,
      personId: a.person.id,
      status: "invitado",
      invitedBy: a.admin.id,
    });

    const coded = await openSelfServiceAction(
      altaTeammateA,
      {},
      formData({ companyId: a.companyId, modo: "codigo" }),
    );
    expect(coded.code).toMatch(/^[A-Z0-9-]{12,}$/);
    expect(await intakeOf(altaTeammateA)).toMatchObject({
      status: "invitado",
    });

    // A second open keeps the same form.
    expect(await openSelfService(a.companyId, altaA, a.admin.id)).toEqual({
      ok: false,
      error: INTAKE_COPY.hrExists,
    });
  });

  it("lib:onboarding/intake/getIntakeForOnboarding", async () => {
    expect(await getIntakeForOnboarding(b.companyId, altaA)).toBeNull();
    expect((await getIntakeForOnboarding(a.companyId, altaA))?.personId).toBe(
      a.person.id,
    );
  });
});

describe("the employee fills only their own form", () => {
  it("action:onboarding/saveEmployeeIntakeAction", async () => {
    employee.current = null;
    expect(
      await redirectOf(() =>
        saveEmployeeIntakeAction({}, formData({ telefono: "1" })),
      ),
    ).toBe("/mi/entrar");

    // B's person has no self-service form; A's stays untouched.
    employee.current = ctx.b;
    expect(
      await saveEmployeeIntakeAction(
        {},
        formData({ ...FORM, intencion: "enviar" }),
      ),
    ).toMatchObject({ error: INTAKE_COPY.notOpen });
    expect((await intakeOf(altaA))?.data).toEqual({});
    expect(await getEmployeeIntake(ctx.b)).toBeNull();

    // A's person must accept the privacy notice first.
    employee.current = ctx.a;
    expect(
      await saveEmployeeIntakeAction({}, formData({ telefono: "55" })),
    ).toMatchObject({ error: INTAKE_COPY.noticePending });
    await recordPrivacyAcceptance(a.companyId, {
      personId: a.person.id,
      noticeId: noticeA,
      channel: "employee_app",
    });

    // A draft keeps what was typed; sending needs every required field.
    expect(
      await saveEmployeeIntakeAction(
        {},
        formData({ telefono: "55 1234 5678", intencion: "guardar" }),
      ),
    ).toEqual({ notice: INTAKE_COPY.saved });
    const refused = await saveEmployeeIntakeAction(
      {},
      formData({ telefono: "55 1234 5678", intencion: "enviar" }),
    );
    expect(refused.fieldErrors?.rfc).toBeDefined();
    expect(refused.values).toEqual({ telefono: "55 1234 5678" });
    expect(await intakeOf(altaA)).toMatchObject({
      status: "invitado",
      data: { telefono: "55 1234 5678" },
    });

    expect(
      await saveEmployeeIntakeAction(
        {},
        formData({ ...FORM, intencion: "enviar" }),
      ),
    ).toEqual({ notice: INTAKE_COPY.sent });
    expect(await intakeOf(altaA)).toMatchObject({
      status: "enviado",
      submittedByAccountId: ctx.a.accountId,
    });
    // HR with people:update hears about it (W2-08); B's HR does not.
    const sentNotices = await ownerDb
      .select()
      .from(notifications)
      .where(eq(notifications.template, "onboarding_submitted"));
    expect(sentNotices.map((row) => row.recipientUserId)).toContain(a.admin.id);
    expect(sentNotices.map((row) => row.recipientUserId)).not.toContain(
      a.viewer.id,
    );
    expect(sentNotices.every((row) => row.companyId === a.companyId)).toBe(
      true,
    );
    expect(sentNotices[0]).toMatchObject({
      url: `/app/altas/${altaA}`,
      title: `${a.person.nombres} Idor envió sus datos de alta`,
    });

    // Sent: locked until HR decides.
    expect(
      await saveEmployeeIntakeAction(
        {},
        formData({ telefono: "1", intencion: "guardar" }),
      ),
    ).toMatchObject({ error: INTAKE_COPY.locked });

    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.actorEmployeeAccountId, ctx.a.accountId),
          eq(auditEvents.resourceId, altaA),
        ),
      )
      .orderBy(auditEvents.occurredAt)
      .limit(1);
    expect(audit).toMatchObject({ source: "employee", action: "update" });
    // Field names only, never the values.
    expect(JSON.stringify(audit!.payload)).not.toContain("GOMA950412AB1");
  });

  it("the person's record does not change until HR applies", async () => {
    const [person] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, a.person.id));
    expect(person!.telefono).toBeNull();
  });
});

describe("HR reviews inside the Captura RH stage", () => {
  it("lib:onboarding/intake/intakeBlocksHrApproval", async () => {
    expect(await intakeBlocksHrApproval(b.companyId, altaA)).toBe(false);
    expect(await intakeBlocksHrApproval(a.companyId, altaA)).toBe(true);

    await updateOnboarding(
      a.companyId,
      altaA,
      {
        checklist: FULL,
        infonavitCredito: null,
        infonavitTipoDescuento: null,
        infonavitFactor: null,
        fonacotCredito: null,
        fonacotDescuento: null,
      },
      a.admin.id,
    );
    await expect(
      approveOnboardingStep(a.companyId, altaA, a.admin.id),
    ).rejects.toThrow(INTAKE_COPY.hrNeedsReview);
  });

  it("lib:onboarding/intake/returnIntake", async () => {
    expect(
      await returnIntake(b.companyId, altaA, "incompleto", b.admin.id),
    ).toEqual({ ok: false, error: "Esta alta no tiene autoservicio." });
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("action:onboarding/returnIntakeAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        returnIntakeAction(
          altaA,
          formData({ companyId: b.companyId, motivo: "incompleto" }),
        ),
      ),
    ).toMatch(/error=domain/);
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("rbac:action:onboarding/returnIntakeAction", async () => {
    actAs(a.viewer);
    expect(
      await redirectOf(() =>
        returnIntakeAction(
          altaA,
          formData({ companyId: a.companyId, motivo: "incompleto" }),
        ),
      ),
    ).toMatch(/error=permission/);
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("returns with a reason from the list and the person sends again", async () => {
    expect(
      await returnIntake(a.companyId, altaA, "texto libre", a.admin.id),
    ).toEqual({ ok: false, error: "Elige el motivo." });

    actAs(a.admin);
    expect(
      await redirectOf(() =>
        returnIntakeAction(
          altaA,
          formData({ companyId: a.companyId, motivo: "datos_incorrectos" }),
        ),
      ),
    ).toMatch(/intake=returned/);
    expect(await intakeOf(altaA)).toMatchObject({
      status: "devuelto",
      returnReason: "datos_incorrectos",
    });

    employee.current = ctx.a;
    expect(
      await saveEmployeeIntakeAction(
        {},
        formData({ ...FORM, intencion: "enviar" }),
      ),
    ).toEqual({ notice: INTAKE_COPY.sent });
    expect(await intakeOf(altaA)).toMatchObject({
      status: "enviado",
      returnReason: null,
    });
  });

  it("lib:onboarding/intake/applyIntake", async () => {
    expect(await applyIntake(b.companyId, altaA, b.admin.id)).toEqual({
      ok: false,
      error: "Esta alta no tiene autoservicio.",
    });
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("action:onboarding/applyIntakeAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        applyIntakeAction(altaA, formData({ companyId: b.companyId })),
      ),
    ).toMatch(/error=domain/);
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("rbac:action:onboarding/applyIntakeAction", async () => {
    actAs(a.viewer);
    expect(
      await redirectOf(() =>
        applyIntakeAction(altaA, formData({ companyId: a.companyId })),
      ),
    ).toMatch(/error=permission/);
    expect((await intakeOf(altaA))?.status).toBe("enviado");
  });

  it("applies to the expediente with at least 80 percent from the person, then HR approves", async () => {
    actAs(a.admin);
    expect(
      await redirectOf(() =>
        applyIntakeAction(altaA, formData({ companyId: a.companyId })),
      ),
    ).toMatch(/intake=applied/);

    const [person] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, a.person.id));
    expect(person).toMatchObject({
      telefono: FORM.telefono,
      rfc: FORM.rfc,
      nss: FORM.nss,
      domicilioCodigoPostal: FORM.domicilioCodigoPostal,
      estadoCivil: "soltero",
      // HR's fields stay.
      nombres: a.person.nombres,
      curp: a.person.curp,
      positionId: a.position.id,
    });

    const intake = await intakeOf(altaA);
    expect(intake).toMatchObject({
      status: "aplicado",
      reviewedBy: a.admin.id,
    });
    expect(
      intake!.fieldsByEmployee! / intake!.fieldsTotal!,
    ).toBeGreaterThanOrEqual(0.8);

    // Applied: the employee form is closed and HR can approve.
    employee.current = ctx.a;
    expect(
      await saveEmployeeIntakeAction({}, formData({ telefono: "1" })),
    ).toMatchObject({ error: INTAKE_COPY.locked });
    expect(
      (await approveOnboardingStep(a.companyId, altaA, a.admin.id)).stage,
    ).toBe("pendiente_nominas");
    expect(await openSelfService(a.companyId, altaA, a.admin.id)).toEqual({
      ok: false,
      error: INTAKE_COPY.hrNotOpen,
    });
  });

  it("B's own alta is untouched by all of the above", async () => {
    expect(await intakeOf(altaB)).toBeUndefined();
  });
});
