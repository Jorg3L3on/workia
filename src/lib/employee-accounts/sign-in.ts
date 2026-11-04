import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbTransaction } from "@/lib/db";
import {
  employeeAccounts,
  employeeCodes,
  employeeSessions,
  people,
  type EmployeeAccount,
  type EmployeeCodePurpose,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { hitRateLimit } from "@/lib/mcp/rate-limit";
import { isValidCurp, normalizeCurp } from "@/lib/people/identity";
import { withTenant } from "@/lib/tenant/scope";

import {
  EMPLOYEE_SESSION_TTL_MS,
  generateLoginCode,
  generateSessionToken,
  hashesMatch,
  hashSecret,
  isPlausibleEmail,
  LOGIN_CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  normalizeActivationCode,
  normalizeEmail,
  normalizeLoginCode,
} from "./credentials";
import { sendLoginCodeEmail } from "./emails";
import { credentialCompany } from "./lookup";

/**
 * Employee sign-in (W2-01, docs/employee-accounts.md). Nothing here takes a
 * company from the caller: the credential (email, CURP or session token)
 * names it through employee_credential_company(), and every read after that
 * runs scoped to it. Answers never say whether an email or CURP has an
 * account.
 */

export const SIGN_IN_COPY = {
  emailInvalid: "Ingresa un correo válido.",
  curpInvalid: "Ingresa tu CURP de 18 caracteres.",
  codeInvalid: "El código no es válido o ya venció. Pide uno nuevo.",
  activationInvalid:
    "La CURP o el código de activación no son válidos, o el código ya venció. Pide uno nuevo a RH.",
  passwordInvalid: "CURP o contraseña incorrectas.",
  passwordShort: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  googleNoAccount:
    "Tu cuenta de Google no tiene acceso a Workia. Pide a RH que te invite con ese correo.",
  emailFailed: "No pudimos enviar el correo. Inténtalo en unos minutos.",
  rateLimited: (seconds: number) =>
    `Demasiados intentos. Espera ${Math.max(1, Math.ceil(seconds / 60))} min y vuelve a intentarlo.`,
} as const;

/** Who is signed in, as the employee guard hands it to every /mi read. */
export type EmployeeContext = {
  accountId: string;
  companyId: string;
  personId: string;
  sessionId: string;
};

export type NewEmployeeSession = { token: string; expiresAt: Date };

export type SignInResult =
  | { ok: true; session: NewEmployeeSession; accountId: string }
  | { ok: false; error: string };

const WINDOW_MS = 15 * 60 * 1000;

/** Per IP and per account or CURP, all in Postgres (no Redis). */
const LIMITS = {
  codeRequestIp: 10,
  codeRequestAccount: 3,
  verifyIp: 30,
  passwordIp: 20,
  passwordCurp: 5,
} as const;

const limited = async (key: string, limit: number) => {
  const result = await hitRateLimit(`employee:${key}`, limit, WINDOW_MS);

  return result.limited ? result.retryAfterSeconds : null;
};

type AccountRow = {
  account: EmployeeAccount;
  personStatus: string;
  personDeletedAt: Date | null;
};

/** The account a credential names, locked, with its person's state. */
const lockAccount = async (
  tx: DbTransaction,
  companyId: string,
  where: { email: string } | { curp: string },
): Promise<AccountRow | null> => {
  const [row] = await tx
    .select({
      account: employeeAccounts,
      personStatus: people.status,
      personDeletedAt: people.deletedAt,
    })
    .from(employeeAccounts)
    .innerJoin(
      people,
      and(
        eq(people.companyId, employeeAccounts.companyId),
        eq(people.id, employeeAccounts.personId),
      ),
    )
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        ne(employeeAccounts.status, "disabled"),
        "email" in where
          ? eq(employeeAccounts.email, where.email)
          : and(eq(people.curp, where.curp), isNull(people.deletedAt)),
      ),
    )
    .limit(1)
    .for("update", { of: employeeAccounts });

  return row ?? null;
};

/** A baja or borrado person never signs in, even if a path missed the revoke. */
const personCanSignIn = (row: AccountRow) =>
  row.personStatus === "activa" && row.personDeletedAt === null;

const latestCode = async (
  tx: DbTransaction,
  companyId: string,
  accountId: string,
  purpose: EmployeeCodePurpose,
) => {
  const [code] = await tx
    .select()
    .from(employeeCodes)
    .where(
      withTenant(
        employeeCodes,
        companyId,
        eq(employeeCodes.accountId, accountId),
        eq(employeeCodes.purpose, purpose),
        isNull(employeeCodes.usedAt),
      ),
    )
    .orderBy(desc(employeeCodes.createdAt))
    .limit(1)
    .for("update");

  return code ?? null;
};

type CodeCheck = "ok" | "wrong" | "unusable";

/** Compares a typed code with the stored one; a wrong try counts. */
const consumeCode = async (
  tx: DbTransaction,
  companyId: string,
  code: Awaited<ReturnType<typeof latestCode>>,
  typedHash: string,
): Promise<CodeCheck> => {
  if (
    !code ||
    code.expiresAt.getTime() <= Date.now() ||
    code.attempts >= MAX_CODE_ATTEMPTS
  ) {
    return "unusable";
  }

  if (!hashesMatch(code.codeHash, typedHash)) {
    await tx
      .update(employeeCodes)
      .set({ attempts: sql`${employeeCodes.attempts} + 1` })
      .where(
        withTenant(employeeCodes, companyId, eq(employeeCodes.id, code.id)),
      );
    return "wrong";
  }

  await tx
    .update(employeeCodes)
    .set({ usedAt: new Date() })
    .where(withTenant(employeeCodes, companyId, eq(employeeCodes.id, code.id)));

  return "ok";
};

const audit = (
  tx: DbTransaction,
  companyId: string,
  accountId: string,
  action: "login" | "activate" | "code_requested" | "logout",
  summary: string,
  result: "success" | "failure" = "success",
) =>
  recordAuditEvent(
    {
      companyId,
      actorEmployeeAccountId: accountId,
      resourceType: "employee_account",
      resourceId: accountId,
      action,
      result,
      source: "employee",
      payload: { summary },
    },
    tx,
  );

/** A new session row; its token goes only to the cookie. */
const openSession = async (
  tx: DbTransaction,
  companyId: string,
  accountId: string,
): Promise<NewEmployeeSession> => {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + EMPLOYEE_SESSION_TTL_MS);

  await tx.insert(employeeSessions).values({
    companyId,
    accountId,
    tokenHash: hashSecret("session", token),
    expiresAt,
  });

  // Expired rows of the company go now and then, so the table stays small.
  if (Math.random() < 0.05) {
    await tx
      .delete(employeeSessions)
      .where(
        withTenant(
          employeeSessions,
          companyId,
          lt(employeeSessions.expiresAt, new Date()),
        ),
      );
    await tx
      .delete(employeeCodes)
      .where(
        withTenant(
          employeeCodes,
          companyId,
          lt(employeeCodes.expiresAt, new Date(Date.now() - 86_400_000)),
        ),
      );
  }

  return { token, expiresAt };
};

/** First sign-in turns an invitation into an active account. */
const markSignedIn = (
  tx: DbTransaction,
  companyId: string,
  account: EmployeeAccount,
  values: Partial<typeof employeeAccounts.$inferInsert> = {},
) => {
  const now = new Date();

  return tx
    .update(employeeAccounts)
    .set({
      status: "active",
      activatedAt: account.activatedAt ?? now,
      lastLoginAt: now,
      ...values,
    })
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.id, account.id),
      ),
    );
};

/**
 * Step 1 of email sign-in: a six-digit code to an invited or active account.
 * Always answers ok for an unknown email, so the form does not reveal who has
 * an account. Rate limited per IP and per account.
 */
export const requestLoginCode = async (input: {
  email: string;
  ip: string;
  origin: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const email = normalizeEmail(input.email);

  if (!isPlausibleEmail(email)) {
    return { ok: false, error: SIGN_IN_COPY.emailInvalid };
  }

  const ipWait = await limited(`code:ip:${input.ip}`, LIMITS.codeRequestIp);

  if (ipWait) {
    return { ok: false, error: SIGN_IN_COPY.rateLimited(ipWait) };
  }

  const companyId = await credentialCompany("email", email);

  if (!companyId) {
    return { ok: true };
  }

  const issued = await withTransaction(async (tx) => {
    const row = await lockAccount(tx, companyId, { email });

    if (!row || !personCanSignIn(row)) {
      return null;
    }

    if (
      await limited(`code:account:${row.account.id}`, LIMITS.codeRequestAccount)
    ) {
      return null;
    }

    await tx
      .delete(employeeCodes)
      .where(
        withTenant(
          employeeCodes,
          companyId,
          eq(employeeCodes.accountId, row.account.id),
          eq(employeeCodes.purpose, "login"),
          isNull(employeeCodes.usedAt),
        ),
      );

    const code = generateLoginCode();

    await tx.insert(employeeCodes).values({
      companyId,
      accountId: row.account.id,
      purpose: "login",
      codeHash: hashSecret("login", code),
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
    });
    await audit(
      tx,
      companyId,
      row.account.id,
      "code_requested",
      "Código de acceso enviado por correo",
    );

    return code;
  }, companyId);

  if (!issued) {
    return { ok: true };
  }

  try {
    await sendLoginCodeEmail({ to: email, code: issued, origin: input.origin });
  } catch (error) {
    logger.error({ err: error, companyId }, "Login code email failed");
    return { ok: false, error: SIGN_IN_COPY.emailFailed };
  }

  return { ok: true };
};

/** Step 2 of email sign-in: the code verifies the email and opens a session. */
export const verifyLoginCode = async (input: {
  email: string;
  code: string;
  ip: string;
}): Promise<SignInResult> => {
  const email = normalizeEmail(input.email);
  const code = normalizeLoginCode(input.code);

  if (!isPlausibleEmail(email) || code.length !== 6) {
    return { ok: false, error: SIGN_IN_COPY.codeInvalid };
  }

  const ipWait = await limited(`verify:ip:${input.ip}`, LIMITS.verifyIp);

  if (ipWait) {
    return { ok: false, error: SIGN_IN_COPY.rateLimited(ipWait) };
  }

  const companyId = await credentialCompany("email", email);

  if (!companyId) {
    return { ok: false, error: SIGN_IN_COPY.codeInvalid };
  }

  return withTransaction(async (tx): Promise<SignInResult> => {
    const row = await lockAccount(tx, companyId, { email });

    if (!row || !personCanSignIn(row)) {
      return { ok: false, error: SIGN_IN_COPY.codeInvalid };
    }

    const { account } = row;
    const check = await consumeCode(
      tx,
      companyId,
      await latestCode(tx, companyId, account.id, "login"),
      hashSecret("login", code),
    );

    if (check !== "ok") {
      if (check === "wrong") {
        await audit(
          tx,
          companyId,
          account.id,
          "login",
          "Código de acceso incorrecto",
          "failure",
        );
      }

      return { ok: false, error: SIGN_IN_COPY.codeInvalid };
    }

    await markSignedIn(tx, companyId, account, {
      emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
    });

    if (account.status === "invited") {
      await audit(
        tx,
        companyId,
        account.id,
        "activate",
        "Cuenta activada con un código por correo",
      );
    }

    await audit(
      tx,
      companyId,
      account.id,
      "login",
      "Entrada con código por correo",
    );

    return {
      ok: true,
      accountId: account.id,
      session: await openSession(tx, companyId, account.id),
    };
  }, companyId);
};

/** People without email: CURP and the password they set when activating. */
export const signInWithPassword = async (input: {
  curp: string;
  password: string;
  ip: string;
}): Promise<SignInResult> => {
  const curp = normalizeCurp(input.curp);

  if (!isValidCurp(curp) || input.password.length === 0) {
    return { ok: false, error: SIGN_IN_COPY.passwordInvalid };
  }

  const wait =
    (await limited(`password:ip:${input.ip}`, LIMITS.passwordIp)) ??
    (await limited(`password:curp:${curp}`, LIMITS.passwordCurp));

  if (wait) {
    return { ok: false, error: SIGN_IN_COPY.rateLimited(wait) };
  }

  const companyId = await credentialCompany("curp", curp);

  if (!companyId) {
    return { ok: false, error: SIGN_IN_COPY.passwordInvalid };
  }

  return withTransaction(async (tx): Promise<SignInResult> => {
    const row = await lockAccount(tx, companyId, { curp });

    if (
      !row ||
      !personCanSignIn(row) ||
      row.account.status !== "active" ||
      !row.account.passwordHash
    ) {
      return { ok: false, error: SIGN_IN_COPY.passwordInvalid };
    }

    if (!(await bcrypt.compare(input.password, row.account.passwordHash))) {
      await audit(
        tx,
        companyId,
        row.account.id,
        "login",
        "Contraseña incorrecta",
        "failure",
      );
      return { ok: false, error: SIGN_IN_COPY.passwordInvalid };
    }

    await markSignedIn(tx, companyId, row.account);
    await audit(
      tx,
      companyId,
      row.account.id,
      "login",
      "Entrada con CURP y contraseña",
    );

    return {
      ok: true,
      accountId: row.account.id,
      session: await openSession(tx, companyId, row.account.id),
    };
  }, companyId);
};

/**
 * The HR activation code with the CURP: sets the password, activates the
 * account (or resets the password of an active one, closing its other
 * sessions) and signs in.
 */
export const activateWithCode = async (input: {
  curp: string;
  code: string;
  password: string;
  ip: string;
}): Promise<SignInResult> => {
  const curp = normalizeCurp(input.curp);
  const code = normalizeActivationCode(input.code);

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: SIGN_IN_COPY.passwordShort };
  }

  if (!isValidCurp(curp) || code.length !== 12) {
    return { ok: false, error: SIGN_IN_COPY.activationInvalid };
  }

  const wait =
    (await limited(`password:ip:${input.ip}`, LIMITS.passwordIp)) ??
    (await limited(`password:curp:${curp}`, LIMITS.passwordCurp));

  if (wait) {
    return { ok: false, error: SIGN_IN_COPY.rateLimited(wait) };
  }

  const companyId = await credentialCompany("curp", curp);

  if (!companyId) {
    return { ok: false, error: SIGN_IN_COPY.activationInvalid };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  return withTransaction(async (tx): Promise<SignInResult> => {
    const row = await lockAccount(tx, companyId, { curp });

    if (!row || !personCanSignIn(row)) {
      return { ok: false, error: SIGN_IN_COPY.activationInvalid };
    }

    const { account } = row;
    const check = await consumeCode(
      tx,
      companyId,
      await latestCode(tx, companyId, account.id, "activation"),
      hashSecret("activation", code),
    );

    if (check !== "ok") {
      if (check === "wrong") {
        await audit(
          tx,
          companyId,
          account.id,
          "activate",
          "Código de activación incorrecto",
          "failure",
        );
      }

      return { ok: false, error: SIGN_IN_COPY.activationInvalid };
    }

    // A reset: sessions opened with the old password end here.
    await tx
      .delete(employeeSessions)
      .where(
        withTenant(
          employeeSessions,
          companyId,
          eq(employeeSessions.accountId, account.id),
        ),
      );
    await markSignedIn(tx, companyId, account, { passwordHash });
    await audit(
      tx,
      companyId,
      account.id,
      "activate",
      account.status === "active"
        ? "Contraseña restablecida con un código de RH"
        : "Cuenta activada con un código de RH",
    );
    await audit(tx, companyId, account.id, "login", "Entrada con código de RH");

    return {
      ok: true,
      accountId: account.id,
      session: await openSession(tx, companyId, account.id),
    };
  }, companyId);
};

/**
 * Google sign-in, after the callback verified the ID token: only for an
 * account whose email equals the Google account's verified email. Google
 * never creates an account.
 */
export const signInWithVerifiedEmail = async (input: {
  email: string;
  provider: "google";
}): Promise<SignInResult> => {
  const email = normalizeEmail(input.email);
  const companyId = isPlausibleEmail(email)
    ? await credentialCompany("email", email)
    : null;

  if (!companyId) {
    return { ok: false, error: SIGN_IN_COPY.googleNoAccount };
  }

  return withTransaction(async (tx): Promise<SignInResult> => {
    const row = await lockAccount(tx, companyId, { email });

    if (!row || !personCanSignIn(row)) {
      return { ok: false, error: SIGN_IN_COPY.googleNoAccount };
    }

    const { account } = row;

    await markSignedIn(tx, companyId, account, {
      emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
    });

    if (account.status === "invited") {
      await audit(
        tx,
        companyId,
        account.id,
        "activate",
        "Cuenta activada con Google",
      );
    }

    await audit(tx, companyId, account.id, "login", "Entrada con Google");

    return {
      ok: true,
      accountId: account.id,
      session: await openSession(tx, companyId, account.id),
    };
  }, companyId);
};

/**
 * The employee behind a session token, or null: the session must be live,
 * the account active and the person active and not borrado.
 */
export const resolveEmployeeSession = async (
  token: string,
): Promise<EmployeeContext | null> => {
  if (!token) {
    return null;
  }

  const tokenHash = hashSecret("session", token);
  const companyId = await credentialCompany("session", tokenHash);

  if (!companyId) {
    return null;
  }

  const [row] = await tdb(companyId)
    .select({
      sessionId: employeeSessions.id,
      accountId: employeeAccounts.id,
      personId: employeeAccounts.personId,
    })
    .from(employeeSessions)
    .innerJoin(
      employeeAccounts,
      and(
        eq(employeeAccounts.companyId, employeeSessions.companyId),
        eq(employeeAccounts.id, employeeSessions.accountId),
      ),
    )
    .innerJoin(
      people,
      and(
        eq(people.companyId, employeeAccounts.companyId),
        eq(people.id, employeeAccounts.personId),
      ),
    )
    .where(
      withTenant(
        employeeSessions,
        companyId,
        eq(employeeSessions.tokenHash, tokenHash),
        gt(employeeSessions.expiresAt, new Date()),
        eq(employeeAccounts.status, "active"),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  return row ? { ...row, companyId } : null;
};

/** Signs out: the session row goes, audited. Unknown tokens do nothing. */
export const endEmployeeSession = async (token: string) => {
  const context = await resolveEmployeeSession(token);

  if (!context) {
    return;
  }

  await withTransaction(async (tx) => {
    await tx
      .delete(employeeSessions)
      .where(
        withTenant(
          employeeSessions,
          context.companyId,
          eq(employeeSessions.id, context.sessionId),
        ),
      );
    await audit(
      tx,
      context.companyId,
      context.accountId,
      "logout",
      "Salida de la app",
    );
  }, context.companyId);
};
