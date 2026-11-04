/**
 * Employee accounts (Workia 2.0 W2-01) on a real database. HR of company B
 * cannot read, invite, issue codes for or disable company A's people, and a
 * role without employee_accounts:manage is denied. Sign-in by email code,
 * CURP and HR activation code, and Google's verified email; an employee reads
 * only their own person; a baja or a borrado disables the account and its
 * sessions in the same transaction. Titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  ip: "203.0.113.10",
  sent: [] as { to: string; subject: string; text: string }[],
}));

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
    new Headers({ host: "workia.test", "x-forwarded-for": jar.ip }),
}));

vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    jar.sent.push(message);
  },
}));

import { GET as googleCallback } from "@/app/api/mi/google/callback/route";
import { GET as googleStart } from "@/app/api/mi/google/route";
import {
  auditEvents,
  employeeAccounts,
  employeeCodes,
  employeeSessions,
  people,
  rateLimits,
} from "@/lib/db/schema";
import {
  activateAccountAction,
  passwordSignInAction,
  requestLoginCodeAction,
  signOutEmployeeAction,
  verifyLoginCodeAction,
} from "@/lib/employee/actions";
import { getEmployeeHome } from "@/lib/employee/home";
import {
  disableEmployeeAccount,
  EMPLOYEE_ACCOUNT_COPY,
  getEmployeeAccount,
  inviteEmployee,
  issueActivationCode,
} from "@/lib/employee-accounts";
import {
  disableEmployeeAccountAction,
  inviteEmployeeAction,
  issueActivationCodeAction,
} from "@/lib/employee-accounts/actions";
import { employeeSessionCookieName } from "@/lib/employee-accounts/session";
import {
  requestLoginCode,
  resolveEmployeeSession,
  SIGN_IN_COPY,
  signInWithVerifiedEmail,
  verifyLoginCode,
} from "@/lib/employee-accounts/sign-in";
import { createPerson, softDeletePerson } from "@/lib/people";
import { terminatePerson } from "@/lib/people/employment";
import type { PersonFormValues } from "@/lib/people/schema";
import { listTerminationReasons } from "@/lib/termination-reasons";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { randomCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
const curps = {} as Record<
  "aPerson" | "aTeammate" | "bPerson" | "bTeammate",
  string
>;
const origin = { origin: "https://workia.test" };
// Emails are unique across companies, and other files create accounts too:
// every address of this file carries a token of this run.
const run = Math.random().toString(36).slice(2, 10);
const mail = (local: string) => `${local}.${run}@empleo.test`;
const emailA = () => mail(`ana.${a.label.toLowerCase()}`);

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const accountsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(employeeAccounts)
    .where(eq(employeeAccounts.companyId, companyId))
    .orderBy(employeeAccounts.createdAt);

const lastCodeTo = (to: string) => {
  const message = [...jar.sent].reverse().find((sent) => sent.to === to);
  return message?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
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

const sessionCookie = () => jar.cookies.get(employeeSessionCookieName()) ?? "";

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Empleada",
  apellidoPaterno: "Cuenta",
  apellidoMaterno: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  fechaIngreso: "2021-02-01",
  areaId: "",
  positionId: "",
  managerId: "",
  siteId: "",
  rfc: "",
  curp: randomCurp(),
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

/** Signs a person in with an email code, as the employee would. */
const signInByEmail = async (email: string) => {
  await requestLoginCode({ email, ip: jar.ip, ...origin });
  const code = lastCodeTo(email);
  const result = await verifyLoginCode({ email, code: code ?? "", ip: jar.ip });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.session.token;
};

beforeAll(async () => {
  a = await seedTenant("CA");
  b = await seedTenant("CB");

  // The fixtures give B the same CURPs as other files' tenants; these must be
  // unique group-wide for the CURP rules under test.
  for (const [key, id] of [
    ["aPerson", a.person.id],
    ["aTeammate", a.teammate.id],
    ["bPerson", b.person.id],
    ["bTeammate", b.teammate.id],
  ] as const) {
    curps[key] = randomCurp();
    await ownerDb
      .update(people)
      .set({ curp: curps[key] })
      .where(eq(people.id, id));
  }
});

beforeEach(async () => {
  jar.cookies.clear();
  jar.ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  // Rate limits are per IP and per account; each test starts fresh.
  await ownerDb.delete(rateLimits);
});

describe("HR manages employee accounts inside its company", () => {
  it("lib:employee-accounts/inviteEmployee", async () => {
    expect(
      await inviteEmployee(
        b.companyId,
        a.person.id,
        emailA(),
        b.admin.id,
        origin,
      ),
    ).toBeNull();
    expect(await accountsOf(a.companyId)).toEqual([]);

    const invited = await inviteEmployee(
      a.companyId,
      a.person.id,
      `  ${emailA().toUpperCase()} `,
      a.admin.id,
      origin,
    );

    expect(invited).toMatchObject({
      ok: true,
      email: emailA(),
      emailSent: true,
    });
    expect(jar.sent.at(-1)?.to).toBe(emailA());
    expect(jar.sent.at(-1)?.text).toContain("https://workia.test/mi/entrar");

    const [account] = await accountsOf(a.companyId);
    expect(account).toMatchObject({
      personId: a.person.id,
      status: "invited",
      email: emailA(),
      emailVerifiedAt: null,
    });

    // The same email cannot go to another person, in this or another company.
    expect(
      await inviteEmployee(
        a.companyId,
        a.teammate.id,
        emailA(),
        a.admin.id,
        origin,
      ),
    ).toEqual({ ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailTaken });
    expect(
      await inviteEmployee(
        b.companyId,
        b.person.id,
        emailA(),
        b.admin.id,
        origin,
      ),
    ).toEqual({ ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailTaken });

    // Re-inviting the same person keeps one account.
    expect(
      await inviteEmployee(
        a.companyId,
        a.person.id,
        emailA(),
        a.admin.id,
        origin,
      ),
    ).toMatchObject({ ok: true });
    expect(await accountsOf(a.companyId)).toHaveLength(1);

    expect(
      await inviteEmployee(
        a.companyId,
        a.person.id,
        "no-es-correo",
        a.admin.id,
        origin,
      ),
    ).toEqual({ ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailInvalid });

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, account.id),
          eq(auditEvents.action, "invite"),
        ),
      );
    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({
      companyId: a.companyId,
      actorUserId: a.admin.id,
      resourceType: "employee_account",
    });
  });

  it("lib:employee-accounts/getEmployeeAccount", async () => {
    expect(await getEmployeeAccount(b.companyId, a.person.id)).toBeNull();
    expect(await getEmployeeAccount(a.companyId, a.person.id)).toMatchObject({
      status: "invited",
      email: emailA(),
      hasPassword: false,
    });
    expect(await getEmployeeAccount(a.companyId, a.teammate.id)).toBeNull();
  });

  it("lib:employee-accounts/issueActivationCode", async () => {
    const before = await accountsOf(a.companyId);

    expect(
      await issueActivationCode(b.companyId, a.teammate.id, b.admin.id),
    ).toBeNull();
    expect(await accountsOf(a.companyId)).toEqual(before);

    const issued = await issueActivationCode(
      a.companyId,
      a.teammate.id,
      a.admin.id,
    );

    expect(issued).toMatchObject({ ok: true });
    if (!issued?.ok) throw new Error("no code");
    expect(issued.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const stored = await ownerDb
      .select()
      .from(employeeCodes)
      .where(eq(employeeCodes.accountId, issued.accountId));
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(issued.code.replace(/-/g, ""));
    expect(await getEmployeeAccount(a.companyId, a.teammate.id)).toMatchObject({
      status: "invited",
      email: null,
    });

    // A new code replaces the unused one.
    await issueActivationCode(a.companyId, a.teammate.id, a.admin.id);
    expect(
      await ownerDb
        .select()
        .from(employeeCodes)
        .where(eq(employeeCodes.accountId, issued.accountId)),
    ).toHaveLength(1);

    // One live account per CURP across the group: B's row with the same
    // CURP as A's teammate (a transfer not yet done) is refused.
    await ownerDb
      .update(people)
      .set({ curp: curps.aTeammate })
      .where(eq(people.id, b.teammate.id));
    expect(
      await issueActivationCode(b.companyId, b.teammate.id, b.admin.id),
    ).toEqual({
      ok: false,
      error: EMPLOYEE_ACCOUNT_COPY.curpTaken,
    });
    expect(
      await inviteEmployee(
        b.companyId,
        b.teammate.id,
        mail("otra"),
        b.admin.id,
        origin,
      ),
    ).toEqual({ ok: false, error: EMPLOYEE_ACCOUNT_COPY.curpTaken });
    await ownerDb
      .update(people)
      .set({ curp: curps.bTeammate })
      .where(eq(people.id, b.teammate.id));
  });

  it("lib:employee-accounts/disableEmployeeAccount", async () => {
    const before = await accountsOf(a.companyId);

    expect(
      await disableEmployeeAccount(b.companyId, a.person.id, b.admin.id),
    ).toBeNull();
    expect(await accountsOf(a.companyId)).toEqual(before);

    // HR disables B's invitation: the email is free again for another person.
    const email = mail("libre");
    await inviteEmployee(b.companyId, b.person.id, email, b.admin.id, origin);
    expect(
      await disableEmployeeAccount(b.companyId, b.person.id, b.admin.id),
    ).toEqual({
      ok: true,
    });
    expect(await getEmployeeAccount(b.companyId, b.person.id)).toMatchObject({
      status: "disabled",
      disabledReason: "rrhh",
    });
    expect(
      await disableEmployeeAccount(b.companyId, b.person.id, b.admin.id),
    ).toBeNull();
    expect(
      await inviteEmployee(
        b.companyId,
        b.teammate.id,
        email,
        b.admin.id,
        origin,
      ),
    ).toMatchObject({ ok: true });
    await disableEmployeeAccount(b.companyId, b.teammate.id, b.admin.id);
  });

  it("action:employee-accounts/inviteEmployeeAction", async () => {
    const before = await accountsOf(a.companyId);

    actAs(b.admin, b.companyId);
    expect(
      await inviteEmployeeAction(
        {},
        formData({
          companyId: b.companyId,
          personId: a.teammate.id,
          email: mail("x"),
        }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.personNotFound });
    expect(
      await inviteEmployeeAction(
        {},
        formData({
          companyId: a.companyId,
          personId: a.teammate.id,
          email: mail("x"),
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await accountsOf(a.companyId)).toEqual(before);
  });

  it("rbac:action:employee-accounts/inviteEmployeeAction", async () => {
    actAs(a.editor, a.companyId);
    expect(
      await inviteEmployeeAction(
        {},
        formData({
          companyId: a.companyId,
          personId: a.teammate.id,
          email: mail("x"),
        }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.denied });
  });

  it("action:employee-accounts/issueActivationCodeAction", async () => {
    const before = await ownerDb
      .select()
      .from(employeeCodes)
      .where(eq(employeeCodes.companyId, a.companyId));

    actAs(b.admin, b.companyId);
    expect(
      await issueActivationCodeAction(
        {},
        formData({ companyId: b.companyId, personId: a.teammate.id }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.personNotFound });
    expect(
      await ownerDb
        .select()
        .from(employeeCodes)
        .where(eq(employeeCodes.companyId, a.companyId)),
    ).toEqual(before);
  });

  it("rbac:action:employee-accounts/issueActivationCodeAction", async () => {
    actAs(a.viewer, a.companyId);
    expect(
      await issueActivationCodeAction(
        {},
        formData({ companyId: a.companyId, personId: a.teammate.id }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.denied });
  });

  it("action:employee-accounts/disableEmployeeAccountAction", async () => {
    const before = await accountsOf(a.companyId);

    actAs(b.admin, b.companyId);
    expect(
      await disableEmployeeAccountAction(
        {},
        formData({ companyId: b.companyId, personId: a.person.id }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.noAccount });
    expect(await accountsOf(a.companyId)).toEqual(before);
  });

  it("rbac:action:employee-accounts/disableEmployeeAccountAction", async () => {
    actAs(a.editor, a.companyId);
    expect(
      await disableEmployeeAccountAction(
        {},
        formData({ companyId: a.companyId, personId: a.person.id }),
      ),
    ).toEqual({ error: EMPLOYEE_ACCOUNT_COPY.denied });
    expect((await getEmployeeAccount(a.companyId, a.person.id))?.status).toBe(
      "invited",
    );
  });
});

describe("employee sign-in", () => {
  it("action:employee/requestLoginCodeAction", async () => {
    const sentBefore = jar.sent.length;

    // An unknown email gets the same answer and no email.
    expect(
      await requestLoginCodeAction({}, formData({ email: mail("nadie") })),
    ).toEqual({ codeSent: true, email: mail("nadie") });
    expect(jar.sent.length).toBe(sentBefore);

    expect(
      await requestLoginCodeAction({}, formData({ email: emailA() })),
    ).toEqual({ codeSent: true, email: emailA() });
    expect(lastCodeTo(emailA())).toMatch(/^\d{6}$/);

    expect(
      await requestLoginCodeAction({}, formData({ email: "mal" })),
    ).toMatchObject({ error: SIGN_IN_COPY.emailInvalid });
  });

  it("action:employee/verifyLoginCodeAction", async () => {
    await requestLoginCodeAction({}, formData({ email: emailA() }));
    const code = lastCodeTo(emailA())!;
    const wrong = code === "000000" ? "111111" : "000000";

    expect(
      await verifyLoginCodeAction(
        {},
        formData({ email: emailA(), code: wrong }),
      ),
    ).toMatchObject({ error: SIGN_IN_COPY.codeInvalid });
    expect(sessionCookie()).toBe("");

    expect(
      await redirectOf(() =>
        verifyLoginCodeAction({}, formData({ email: emailA(), code })),
      ),
    ).toBe("/mi");

    // First sign-in activates the invitation and verifies the email.
    const account = await getEmployeeAccount(a.companyId, a.person.id);
    expect(account).toMatchObject({ status: "active" });
    expect(account?.emailVerifiedAt).not.toBeNull();

    const context = await resolveEmployeeSession(sessionCookie());
    expect(context).toMatchObject({
      companyId: a.companyId,
      personId: a.person.id,
      accountId: account?.id,
    });

    // The code is single use.
    expect(
      await verifyLoginCode({ email: emailA(), code, ip: jar.ip }),
    ).toEqual({ ok: false, error: SIGN_IN_COPY.codeInvalid });

    const audit = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorEmployeeAccountId, account!.id));
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining(["code_requested", "activate", "login"]),
    );
    expect(audit.every((event) => event.source === "employee")).toBe(true);
  });

  it("stops a code after five wrong tries", async () => {
    await requestLoginCode({ email: emailA(), ip: jar.ip, ...origin });
    const code = lastCodeTo(emailA())!;
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await verifyLoginCode({ email: emailA(), code: wrong, ip: jar.ip }))
          .ok,
      ).toBe(false);
    }

    expect(
      await verifyLoginCode({ email: emailA(), code, ip: jar.ip }),
    ).toEqual({
      ok: false,
      error: SIGN_IN_COPY.codeInvalid,
    });
  });

  it("rate limits code requests per account and per IP", async () => {
    const sentBefore = jar.sent.length;

    for (let request = 0; request < 5; request += 1) {
      expect(
        await requestLoginCode({
          email: emailA(),
          ip: `198.51.100.${request}`,
          ...origin,
        }),
      ).toEqual({ ok: true });
    }

    // Three per account in the window; the rest are dropped silently.
    expect(jar.sent.length - sentBefore).toBe(3);

    for (let request = 0; request < 10; request += 1) {
      await requestLoginCode({
        email: mail(`x${request}`),
        ip: jar.ip,
        ...origin,
      });
    }

    expect(
      await requestLoginCode({ email: mail("y"), ip: jar.ip, ...origin }),
    ).toMatchObject({ ok: false });
  });

  it("action:employee/activateAccountAction", async () => {
    const issued = await issueActivationCode(
      a.companyId,
      a.teammate.id,
      a.admin.id,
    );
    if (!issued?.ok) throw new Error("no code");

    // B's CURP with A's code, a short password and a mismatch are refused.
    expect(
      await activateAccountAction(
        {},
        formData({
          curp: curps.bPerson,
          code: issued.code,
          password: "Segura123",
          confirm: "Segura123",
        }),
      ),
    ).toEqual({ error: SIGN_IN_COPY.activationInvalid });
    expect(
      await activateAccountAction(
        {},
        formData({
          curp: curps.aTeammate,
          code: issued.code,
          password: "corta",
          confirm: "corta",
        }),
      ),
    ).toEqual({ error: SIGN_IN_COPY.passwordShort });
    expect(
      await activateAccountAction(
        {},
        formData({
          curp: curps.aTeammate,
          code: issued.code,
          password: "Segura123",
          confirm: "Otra1234",
        }),
      ),
    ).toEqual({ error: "Las contraseñas no coinciden." });

    expect(
      await redirectOf(() =>
        activateAccountAction(
          {},
          formData({
            curp: curps.aTeammate.toLowerCase(),
            code: issued.code.replace(/-/g, " ").toLowerCase(),
            password: "Segura123",
            confirm: "Segura123",
          }),
        ),
      ),
    ).toBe("/mi");
    expect(await resolveEmployeeSession(sessionCookie())).toMatchObject({
      personId: a.teammate.id,
    });
    expect(await getEmployeeAccount(a.companyId, a.teammate.id)).toMatchObject({
      status: "active",
      hasPassword: true,
    });
  });

  it("action:employee/passwordSignInAction", async () => {
    expect(
      await passwordSignInAction(
        {},
        formData({ curp: curps.aTeammate, password: "Equivocada1" }),
      ),
    ).toEqual({ error: SIGN_IN_COPY.passwordInvalid });
    expect(
      await passwordSignInAction(
        {},
        formData({ curp: curps.bPerson, password: "Segura123" }),
      ),
    ).toEqual({ error: SIGN_IN_COPY.passwordInvalid });
    expect(
      await redirectOf(() =>
        passwordSignInAction(
          {},
          formData({ curp: curps.aTeammate, password: "Segura123" }),
        ),
      ),
    ).toBe("/mi");
    expect(await resolveEmployeeSession(sessionCookie())).toMatchObject({
      companyId: a.companyId,
      personId: a.teammate.id,
    });
  });

  it("action:employee/signOutEmployeeAction", async () => {
    const token = await signInByEmail(emailA());
    jar.cookies.set(employeeSessionCookieName(), token);

    expect(await redirectOf(() => signOutEmployeeAction())).toBe("/mi/entrar");
    expect(sessionCookie()).toBe("");
    expect(await resolveEmployeeSession(token)).toBeNull();
  });

  it("signs in with Google only for an account with that verified email", async () => {
    expect(
      await signInWithVerifiedEmail({
        email: "desconocida@gmail.com",
        provider: "google",
      }),
    ).toEqual({ ok: false, error: SIGN_IN_COPY.googleNoAccount });

    const result = await signInWithVerifiedEmail({
      email: emailA().toUpperCase(),
      provider: "google",
    });
    expect(result).toMatchObject({ ok: true });
    expect(
      await ownerDb
        .select()
        .from(employeeAccounts)
        .where(eq(employeeAccounts.email, "desconocida@gmail.com")),
    ).toEqual([]);
  });

  it("route:GET /api/mi/google", async () => {
    // Without the Google client configured the button is hidden and the route
    // sends the employee back to the form.
    const response = await googleStart(
      new NextRequest("https://workia.test/api/mi/google"),
    );
    expect(response.headers.get("location")).toBe(
      "https://workia.test/mi/entrar?error=google",
    );
  });

  it("route:GET /api/mi/google/callback", async () => {
    // A callback without the state cookie (a forged or replayed redirect)
    // never opens a session.
    const response = await googleCallback(
      new NextRequest(
        "https://workia.test/api/mi/google/callback?code=x&state=y",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://workia.test/mi/entrar?error=google",
    );
    expect(response.cookies.get(employeeSessionCookieName())).toBeUndefined();
  });
});

describe("an employee reads only their own person", () => {
  it("lib:employee/home (own person only)", async () => {
    const own = await resolveEmployeeSession(await signInByEmail(emailA()));
    if (!own) throw new Error("no session");

    expect(await getEmployeeHome(own)).toMatchObject({
      personId: a.person.id,
      nombres: a.person.nombres,
      email: emailA(),
    });

    // The guard is the only source of personId: pairing the account with a
    // teammate, or with the other company, reads nothing.
    expect(
      await getEmployeeHome({ ...own, personId: a.teammate.id }),
    ).toBeNull();
    expect(
      await getEmployeeHome({ ...own, companyId: b.companyId }),
    ).toBeNull();
    expect(
      await getEmployeeHome({
        ...own,
        companyId: b.companyId,
        personId: b.person.id,
      }),
    ).toBeNull();
  });

  it("a session token names one account in one company", async () => {
    const token = await signInByEmail(emailA());
    const [row] = await ownerDb
      .select()
      .from(employeeSessions)
      .where(eq(employeeSessions.companyId, a.companyId))
      .orderBy(employeeSessions.createdAt);

    expect(JSON.stringify(row)).not.toContain(token);
    expect(await resolveEmployeeSession(`${token}x`)).toBeNull();
    expect(await resolveEmployeeSession("")).toBeNull();
  });
});

describe("revocation", () => {
  it("a baja disables the account and ends its sessions in the same transaction", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Baja" }),
      a.admin.id,
    );
    const email = mail(`baja.${a.label.toLowerCase()}`);
    await inviteEmployee(a.companyId, person.id, email, a.admin.id, origin);
    const token = await signInByEmail(email);
    expect(await resolveEmployeeSession(token)).toMatchObject({
      personId: person.id,
    });

    const [reason] = await listTerminationReasons(a.companyId);
    await terminatePerson(
      a.companyId,
      person.id,
      {
        fechaBaja: "2026-10-31",
        tipoBaja: "voluntaria",
        motivoBajaId: reason.id,
        comentario: "",
        recontratable: true,
      },
      a.admin.id,
    );

    expect(await resolveEmployeeSession(token)).toBeNull();
    const account = await getEmployeeAccount(a.companyId, person.id);
    expect(account).toMatchObject({
      status: "disabled",
      disabledReason: "baja",
    });
    expect(
      await ownerDb
        .select()
        .from(employeeSessions)
        .where(eq(employeeSessions.accountId, account!.id)),
    ).toEqual([]);
    expect((await requestLoginCode({ email, ip: jar.ip, ...origin })).ok).toBe(
      true,
    );
    expect(
      await verifyLoginCode({
        email,
        code: lastCodeTo(email) ?? "",
        ip: jar.ip,
      }),
    ).toMatchObject({
      ok: false,
    });

    // A baja cannot be invited again until a reingreso.
    expect(
      await inviteEmployee(a.companyId, person.id, email, a.admin.id, origin),
    ).toEqual({ ok: false, error: EMPLOYEE_ACCOUNT_COPY.personInactive });
  });

  it("a borrado disables the account too", async () => {
    const person = await createPerson(
      a.companyId,
      personForm({ nombres: "Borrada" }),
      a.admin.id,
    );
    const issued = await issueActivationCode(
      a.companyId,
      person.id,
      a.admin.id,
    );
    expect(issued).toMatchObject({ ok: true });

    await softDeletePerson(a.companyId, person.id, a.admin.id);

    const [account] = await ownerDb
      .select()
      .from(employeeAccounts)
      .where(eq(employeeAccounts.personId, person.id));
    expect(account).toMatchObject({
      status: "disabled",
      disabledReason: "borrado",
    });
    expect(
      await ownerDb
        .select()
        .from(employeeCodes)
        .where(eq(employeeCodes.accountId, account.id)),
    ).toEqual([]);

    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, account.id),
          eq(auditEvents.action, "deactivate"),
        ),
      );
    expect(event).toMatchObject({
      companyId: a.companyId,
      actorUserId: a.admin.id,
    });
  });
});
