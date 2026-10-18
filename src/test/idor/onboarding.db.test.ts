/**
 * Hiring (alta) from HR to Payroll with two approvals (WRK-I5-7): isolation,
 * permissions per stage, and that one user cannot approve both stages (in the
 * domain and by a database constraint). Test titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { companyMemberships, onboardings, roles, users } from "@/lib/db/schema";
import {
  approveOnboardingStep,
  getOnboardingById,
  getOnboardingByPerson,
  listOnboardings,
  rejectOnboarding,
  startOnboarding,
  updateOnboarding,
} from "@/lib/onboarding";
import {
  approveOnboardingAction,
  rejectOnboardingAction,
  startOnboardingAction,
  updateOnboardingAction,
} from "@/lib/onboarding/actions";
import { ONBOARDING_CHECKLIST } from "@/lib/onboarding/schema";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
/** A second admin of company A: Payroll, distinct from the HR approver. */
let payroll: { id: string; email: string };
let altaA: typeof onboardings.$inferSelect;

const FULL = Object.fromEntries(
  ONBOARDING_CHECKLIST.map((item) => [item, true]),
) as Record<(typeof ONBOARDING_CHECKLIST)[number], boolean>;

const capture = (checklist = FULL) => ({
  checklist,
  infonavitCredito: null,
  infonavitTipoDescuento: null,
  infonavitFactor: null,
  fonacotCredito: null,
  fonacotDescuento: null,
});

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

const row = async (id: string) =>
  (await ownerDb.select().from(onboardings).where(eq(onboardings.id, id)))[0];

beforeAll(async () => {
  a = await seedTenant("AA");
  b = await seedTenant("AB");
  const [adminRole] = await ownerDb
    .select()
    .from(roles)
    .where(eq(roles.slug, "admin"));
  const [user] = await ownerDb
    .insert(users)
    .values({
      email: `nominas-${randomUUID().slice(0, 8)}@idor.test`,
      name: "Nóminas",
    })
    .returning();
  await ownerDb.insert(companyMemberships).values({
    userId: user.id,
    companyId: a.companyId,
    roleId: adminRole.id,
    isDefault: true,
  });
  payroll = { id: user.id, email: user.email };
  altaA = await startOnboarding(a.companyId, a.person.id, a.admin.id);
});

describe("altas stay inside the company", () => {
  it("lib:onboarding/listOnboardings", async () => {
    const rows = await listOnboardings(b.companyId);
    expect(rows.map((item) => item.onboarding.id)).not.toContain(altaA.id);
  });

  it("lib:onboarding/getOnboardingById", async () => {
    expect(await getOnboardingById(b.companyId, altaA.id)).toBeNull();
  });

  it("lib:onboarding/getOnboardingByPerson", async () => {
    expect(await getOnboardingByPerson(b.companyId, a.person.id)).toBeNull();
  });

  it("lib:onboarding/startOnboarding", async () => {
    await expect(
      startOnboarding(b.companyId, a.teammate.id, b.admin.id),
    ).rejects.toThrow("Persona no encontrada.");
    expect(await getOnboardingByPerson(a.companyId, a.teammate.id)).toBeNull();
  });

  it.each([
    [
      "lib:onboarding/updateOnboarding",
      () => updateOnboarding(b.companyId, altaA.id, capture(), b.admin.id),
    ],
    [
      "lib:onboarding/approveOnboardingStep",
      () => approveOnboardingStep(b.companyId, altaA.id, b.admin.id),
    ],
    [
      "lib:onboarding/rejectOnboarding",
      () => rejectOnboarding(b.companyId, altaA.id, "x", b.admin.id),
    ],
  ])("%s", async (_surface, write) => {
    await expect(write()).rejects.toThrow("Alta no encontrada.");
    expect((await row(altaA.id)).stage).toBe("rh_captura");
  });
});

describe("alta actions with company B's session", () => {
  it.each([
    [
      "action:onboarding/updateOnboardingAction",
      () =>
        updateOnboardingAction(
          altaA.id,
          formData({ companyId: b.companyId, checklist_ine: "on" }),
        ),
    ],
    [
      "action:onboarding/approveOnboardingAction",
      () =>
        approveOnboardingAction(altaA.id, formData({ companyId: b.companyId })),
    ],
    [
      "action:onboarding/rejectOnboardingAction",
      () =>
        rejectOnboardingAction(
          altaA.id,
          formData({ companyId: b.companyId, motivo: "x" }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.admin);
    await redirectOf(run);
    const current = await row(altaA.id);
    expect(current.stage).toBe("rh_captura");
    expect(current.checklist).toEqual({});
  });

  it("action:onboarding/startOnboardingAction", async () => {
    actAs(b.admin);
    await redirectOf(() =>
      startOnboardingAction(
        formData({ companyId: b.companyId, personId: a.teammate.id }),
      ),
    );
    expect(await getOnboardingByPerson(a.companyId, a.teammate.id)).toBeNull();
  });
});

describe("alta permissions", () => {
  it.each([
    [
      "rbac:action:onboarding/startOnboardingAction",
      () =>
        startOnboardingAction(
          formData({ companyId: a.companyId, personId: a.teammate.id }),
        ),
    ],
    [
      "rbac:action:onboarding/updateOnboardingAction",
      () =>
        updateOnboardingAction(
          altaA.id,
          formData({ companyId: a.companyId, checklist_ine: "on" }),
        ),
    ],
    [
      "rbac:action:onboarding/approveOnboardingAction",
      () =>
        approveOnboardingAction(altaA.id, formData({ companyId: a.companyId })),
    ],
    [
      "rbac:action:onboarding/rejectOnboardingAction",
      () =>
        rejectOnboardingAction(
          altaA.id,
          formData({ companyId: a.companyId, motivo: "x" }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(a.viewer);
    expect(await redirectOf(run)).toMatch(/error=permission/);
    const current = await row(altaA.id);
    expect(current.stage).toBe("rh_captura");
    expect(await getOnboardingByPerson(a.companyId, a.teammate.id)).toBeNull();
  });
});

describe("the two approvals", () => {
  it("HR needs the full checklist, then Payroll must be another user", async () => {
    await expect(
      approveOnboardingStep(a.companyId, altaA.id, a.admin.id),
    ).rejects.toThrow(/Falta en el checklist: INE/);

    await updateOnboarding(
      a.companyId,
      altaA.id,
      {
        ...capture(),
        infonavitCredito: "1234567890",
        infonavitTipoDescuento: "porcentaje",
        infonavitFactor: 20,
      },
      a.admin.id,
    );
    const hr = await approveOnboardingStep(a.companyId, altaA.id, a.admin.id);
    expect(hr).toMatchObject({
      stage: "pendiente_nominas",
      rhApprovedBy: a.admin.id,
    });

    // The editor has people:update but not payroll:approve.
    actAs(a.editor);
    expect(
      await redirectOf(() =>
        approveOnboardingAction(altaA.id, formData({ companyId: a.companyId })),
      ),
    ).toMatch(/error=permission/);

    // The HR approver also has payroll:approve (admin), but not twice.
    await expect(
      approveOnboardingStep(a.companyId, altaA.id, a.admin.id),
    ).rejects.toThrow(
      "La misma persona no puede aprobar las dos etapas del alta.",
    );
    actAs(a.admin);
    expect(
      await redirectOf(() =>
        approveOnboardingAction(altaA.id, formData({ companyId: a.companyId })),
      ),
    ).toMatch(/error=domain/);

    actAs(payroll);
    expect(
      await redirectOf(() =>
        approveOnboardingAction(altaA.id, formData({ companyId: a.companyId })),
      ),
    ).toMatch(/approved=1/);
    expect(await row(altaA.id)).toMatchObject({
      stage: "completo",
      payrollApprovedBy: payroll.id,
      infonavitFactor: "20.0000",
    });
  });

  it("the database refuses one user in both approvals", async () => {
    await expect(
      ownerDb
        .update(onboardings)
        .set({ payrollApprovedBy: a.admin.id })
        .where(eq(onboardings.id, altaA.id)),
    ).rejects.toThrow();
  });

  it("Payroll can reject with a reason; a closed alta cannot change", async () => {
    const alta = await startOnboarding(a.companyId, a.teammate.id, a.admin.id);
    await updateOnboarding(a.companyId, alta.id, capture(), a.admin.id);
    await approveOnboardingStep(a.companyId, alta.id, a.admin.id);
    const rejected = await rejectOnboarding(
      a.companyId,
      alta.id,
      "Falta el alta en el IMSS",
      payroll.id,
    );
    expect(rejected).toMatchObject({
      stage: "rechazado",
      rejectedReason: "Falta el alta en el IMSS",
    });
    await expect(
      approveOnboardingStep(a.companyId, alta.id, payroll.id),
    ).rejects.toThrow("El alta ya está cerrada.");
    await expect(
      startOnboarding(a.companyId, a.teammate.id, a.admin.id),
    ).rejects.toThrow("Esta persona ya tiene un alta.");
  });
});
