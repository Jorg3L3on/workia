/**
 * Mi expediente (Workia 2.0 W2-02) on a real database. An employee reads only
 * their own record and can only request or cancel corrections of their own
 * person, whatever the form says. HR of company B cannot list or decide
 * company A's corrections, and a role without people:update is denied. The
 * inbox shows before and after values and pages by keyset. Titles are the
 * surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies.has(name)
        ? { name, value: jar.cookies.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      jar.cookies.set(name, value);
    },
    delete: (name: string) => {
      jar.cookies.delete(name);
    },
  }),
  headers: async () =>
    new Headers({ host: "workia.test", "x-forwarded-for": "203.0.113.20" }),
}));

vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  sendEmail: async () => {},
}));

import {
  auditEvents,
  people,
  profileCorrections,
  rateLimits,
} from "@/lib/db/schema";
import {
  cancelProfileCorrectionAction,
  requestProfileCorrectionAction,
} from "@/lib/employee/correction-actions";
import { getEmployeeExpediente } from "@/lib/employee/expediente";
import { inviteEmployee } from "@/lib/employee-accounts";
import { employeeSessionCookieName } from "@/lib/employee-accounts/session";
import {
  resolveEmployeeSession,
  signInWithVerifiedEmail,
  type EmployeeContext,
} from "@/lib/employee-accounts/sign-in";
import {
  countPendingProfileCorrections,
  decideProfileCorrection,
  listPendingProfileCorrections,
  PROFILE_CORRECTION_COPY,
  requestProfileCorrection,
} from "@/lib/profile-corrections";
import { decideProfileCorrectionAction } from "@/lib/profile-corrections/actions";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
const tokens = {} as Record<"a" | "b", string>;
const contexts = {} as Record<"a" | "b", EmployeeContext>;
const curps = {} as Record<"a" | "b", string>;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

/** Runs an action that ends in redirect(); returns where it went. */
const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof NavigationThrow) {
      return error.url ?? error.kind;
    }
    throw error;
  }
  return null;
};

const correctionsOf = (personId: string) =>
  ownerDb
    .select()
    .from(profileCorrections)
    .where(eq(profileCorrections.personId, personId))
    .orderBy(profileCorrections.createdAt);

const signInAs = (who: "a" | "b") => {
  jar.cookies.set(employeeSessionCookieName(), tokens[who]);
};

/** Invites the tenant's person and signs them in (Google's verified email). */
const employeeOf = async (tenant: Tenant, who: "a" | "b") => {
  const email = `mi.${tenant.label.toLowerCase()}@empleo.test`;
  const invited = await inviteEmployee(
    tenant.companyId,
    tenant.person.id,
    email,
    tenant.admin.id,
    { origin: "https://workia.test" },
  );
  if (!invited?.ok) throw new Error("invite failed");

  const result = await signInWithVerifiedEmail({ email, provider: "google" });
  if (!result.ok) throw new Error(result.error);

  tokens[who] = result.session.token;
  const context = await resolveEmployeeSession(result.session.token);
  if (!context) throw new Error("no session");
  contexts[who] = context;
};

beforeAll(async () => {
  a = await seedTenant("PA");
  b = await seedTenant("PB");

  for (const [who, tenant] of [
    ["a", a],
    ["b", b],
  ] as const) {
    curps[who] = uniqueCurp();
    await ownerDb
      .update(people)
      .set({ curp: curps[who], telefono: "9610000000" })
      .where(eq(people.id, tenant.person.id));
    await ownerDb
      .update(people)
      .set({ curp: uniqueCurp() })
      .where(eq(people.id, tenant.teammate.id));
  }

  await ownerDb.delete(rateLimits);
  await employeeOf(a, "a");
  await employeeOf(b, "b");
});

beforeEach(() => {
  jar.cookies.clear();
  actAs(null);
});

describe("Mi expediente reads only the signed-in person", () => {
  it("lib:employee/expediente (own person only)", async () => {
    const own = await getEmployeeExpediente(contexts.a);

    expect(own).toMatchObject({
      person: {
        nombres: a.person.nombres,
        curp: curps.a,
        telefono: "9610000000",
      },
      accountEmail: `mi.${a.label.toLowerCase()}@empleo.test`,
    });
    // Never a contract amount.
    expect(JSON.stringify(own)).not.toMatch(/salario/i);

    expect(
      await getEmployeeExpediente({ ...contexts.a, personId: a.teammate.id }),
    ).toBeNull();
    expect(
      await getEmployeeExpediente({ ...contexts.a, companyId: b.companyId }),
    ).toBeNull();
    expect(
      await getEmployeeExpediente({
        ...contexts.a,
        companyId: b.companyId,
        personId: b.person.id,
      }),
    ).toBeNull();
  });
});

describe("employees request corrections of their own record", () => {
  it("action:employee/requestProfileCorrectionAction", async () => {
    // Without a session: to sign-in, nothing written.
    expect(
      await redirectOf(() =>
        requestProfileCorrectionAction(
          {},
          formData({ field: "telefono", proposedValue: "9619999999" }),
        ),
      ),
    ).toBe("/mi/entrar");

    signInAs("a");
    // The form cannot point at another person or company.
    expect(
      await redirectOf(() =>
        requestProfileCorrectionAction(
          {},
          formData({
            field: "telefono",
            proposedValue: "9619999999",
            note: "Cambié de número",
            personId: b.person.id,
            companyId: b.companyId,
          }),
        ),
      ),
    ).toBe("/mi/expediente?enviada=1#mis-correcciones");

    expect(await correctionsOf(b.person.id)).toEqual([]);
    const [created] = await correctionsOf(a.person.id);
    expect(created).toMatchObject({
      companyId: a.companyId,
      accountId: contexts.a.accountId,
      field: "telefono",
      currentValue: "9610000000",
      proposedValue: "9619999999",
      note: "Cambié de número",
      status: "pendiente",
      decidedAt: null,
    });

    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceType, "profile_correction"),
          eq(auditEvents.resourceId, created.id),
        ),
      );
    expect(audit).toMatchObject({
      companyId: a.companyId,
      action: "create",
      source: "employee",
      actorEmployeeAccountId: contexts.a.accountId,
      actorUserId: null,
    });

    // One pending request per field.
    expect(
      await requestProfileCorrectionAction(
        {},
        formData({ field: "telefono", proposedValue: "9618888888" }),
      ),
    ).toMatchObject({ error: PROFILE_CORRECTION_COPY.duplicate });
    // The value it already has, a field outside the catalog, an empty value.
    expect(
      await requestProfileCorrectionAction(
        {},
        formData({
          field: "curp",
          proposedValue: ` ${curps.a.toLowerCase()} `,
        }),
      ),
    ).toMatchObject({ error: PROFILE_CORRECTION_COPY.sameValue });
    for (const field of ["salarioDiario", "antiguedad", "contratoFin", ""]) {
      expect(
        await requestProfileCorrectionAction(
          {},
          formData({ field, proposedValue: "x" }),
        ),
      ).toMatchObject({ error: PROFILE_CORRECTION_COPY.unknownField });
    }
    expect(
      await requestProfileCorrectionAction(
        {},
        formData({ field: "rfc", proposedValue: "   " }),
      ),
    ).toMatchObject({ error: PROFILE_CORRECTION_COPY.emptyValue });
    expect(await correctionsOf(a.person.id)).toHaveLength(1);
  });

  it("action:employee/cancelProfileCorrectionAction", async () => {
    const theirs = await requestProfileCorrection(contexts.b, {
      field: "nacionalidad",
      proposedValue: "Mexicana",
    });
    if (!theirs.ok) throw new Error(theirs.error);

    // A's employee cannot cancel B's request, even with its id.
    signInAs("a");
    expect(
      await redirectOf(() =>
        cancelProfileCorrectionAction(formData({ id: theirs.id })),
      ),
    ).toBe("/mi/expediente#mis-correcciones");
    const [stillPending] = await ownerDb
      .select()
      .from(profileCorrections)
      .where(eq(profileCorrections.id, theirs.id));
    expect(stillPending.status).toBe("pendiente");

    // B cancels their own.
    signInAs("b");
    await redirectOf(() =>
      cancelProfileCorrectionAction(formData({ id: theirs.id })),
    );
    const [cancelled] = await ownerDb
      .select()
      .from(profileCorrections)
      .where(eq(profileCorrections.id, theirs.id));
    expect(cancelled).toMatchObject({ status: "cancelada", decidedBy: null });
    expect(cancelled.decidedAt).not.toBeNull();
  });
});

describe("HR's corrections inbox stays inside its company", () => {
  it("lib:profile-corrections/listPendingProfileCorrections", async () => {
    const second = await requestProfileCorrection(contexts.a, {
      field: "lugarNacimiento",
      proposedValue: "Tuxtla Gutiérrez, Chiapas",
    });
    if (!second.ok) throw new Error(second.error);

    const page = await listPendingProfileCorrections(b.companyId);
    expect(page.items.map((item) => item.personId)).not.toContain(a.person.id);

    // Oldest first, one keyset page at a time.
    const first = await listPendingProfileCorrections(a.companyId, {
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      personId: a.person.id,
      field: "telefono",
      currentValue: "9610000000",
      proposedValue: "9619999999",
    });
    expect(first.next).not.toBeNull();

    const next = await listPendingProfileCorrections(a.companyId, {
      limit: 1,
      cursor: first.next,
    });
    expect(next.items.map((item) => item.field)).toEqual(["lugarNacimiento"]);
    expect(next.items[0].currentValue).toBeNull();
    expect(next.next).toBeNull();

    // A tampered cursor starts over instead of failing.
    expect(
      (
        await listPendingProfileCorrections(a.companyId, {
          cursor: "not-a-cursor",
        })
      ).items,
    ).toHaveLength(2);
  });

  it("lib:profile-corrections/countPendingProfileCorrections", async () => {
    expect(await countPendingProfileCorrections(a.companyId)).toBe(2);
    expect(await countPendingProfileCorrections(b.companyId)).toBe(0);
  });

  it("lib:profile-corrections/decideProfileCorrection", async () => {
    const [pending] = await correctionsOf(a.person.id);

    expect(
      await decideProfileCorrection(
        b.companyId,
        { id: pending.id, decision: "aplicada" },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: PROFILE_CORRECTION_COPY.notFound });
    expect(
      await decideProfileCorrection(
        a.companyId,
        { id: pending.id, decision: "rechazada", reason: "  " },
        a.admin.id,
      ),
    ).toEqual({ ok: false, error: PROFILE_CORRECTION_COPY.reasonRequired });
    const [unchanged] = await correctionsOf(a.person.id);
    expect(unchanged.status).toBe("pendiente");

    expect(
      await decideProfileCorrection(
        a.companyId,
        { id: pending.id, decision: "aplicada" },
        a.admin.id,
      ),
    ).toEqual({ ok: true, id: pending.id });
    const [applied] = await correctionsOf(a.person.id);
    expect(applied).toMatchObject({
      status: "aplicada",
      decidedBy: a.admin.id,
    });

    // Closed once: a second decision is refused.
    expect(
      await decideProfileCorrection(
        a.companyId,
        { id: pending.id, decision: "rechazada", reason: "No" },
        a.admin.id,
      ),
    ).toEqual({ ok: false, error: PROFILE_CORRECTION_COPY.notPending });

    // The field is free again for a new request.
    expect(
      await requestProfileCorrection(contexts.a, {
        field: "telefono",
        proposedValue: "9617777777",
      }),
    ).toMatchObject({ ok: true });
  });

  it("action:profile-corrections/decideProfileCorrectionAction", async () => {
    const [, lugar] = await correctionsOf(a.person.id);

    // HR of B, with its own company in the form, cannot touch A's request.
    actAs(b.admin, b.companyId);
    expect(
      await decideProfileCorrectionAction(
        {},
        formData({
          id: lugar.id,
          decision: "rechazada",
          reason: "No",
          companyId: b.companyId,
        }),
      ),
    ).toEqual({ error: PROFILE_CORRECTION_COPY.notFound });
    // A form opened in A, sent while B is active: stale.
    expect(
      await decideProfileCorrectionAction(
        {},
        formData({
          id: lugar.id,
          decision: "rechazada",
          reason: "No",
          companyId: a.companyId,
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });

    actAs(a.admin, a.companyId);
    expect(
      await decideProfileCorrectionAction(
        {},
        formData({
          id: lugar.id,
          decision: "rechazada",
          reason: "Tu acta dice Chiapa de Corzo.",
          companyId: a.companyId,
        }),
      ),
    ).toEqual({ done: true });
    const [, rejected] = await correctionsOf(a.person.id);
    expect(rejected).toMatchObject({
      status: "rechazada",
      decisionReason: "Tu acta dice Chiapa de Corzo.",
      decidedBy: a.admin.id,
    });
    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, lugar.id),
          eq(auditEvents.action, "reject"),
        ),
      );
    expect(audit).toMatchObject({
      companyId: a.companyId,
      actorUserId: a.admin.id,
      resourceType: "profile_correction",
    });
  });

  it("rbac:action:profile-corrections/decideProfileCorrectionAction", async () => {
    const latest = (await correctionsOf(a.person.id)).at(-1)!;
    expect(latest.status).toBe("pendiente");

    actAs(a.viewer, a.companyId);
    expect(
      await decideProfileCorrectionAction(
        {},
        formData({
          id: latest.id,
          decision: "aplicada",
          companyId: a.companyId,
        }),
      ),
    ).toEqual({ error: PROFILE_CORRECTION_COPY.denied });
    expect((await correctionsOf(a.person.id)).at(-1)?.status).toBe("pendiente");

    actAs(a.editor, a.companyId);
    expect(
      await decideProfileCorrectionAction(
        {},
        formData({
          id: latest.id,
          decision: "aplicada",
          companyId: a.companyId,
        }),
      ),
    ).toEqual({ done: true });
  });
});
