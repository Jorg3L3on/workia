import { desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbTransaction } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  employeeAccounts,
  employeeCodes,
  people,
  type EmployeeAccount,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { isValidCurp, normalizeCurp } from "@/lib/people/identity";
import { withTenant } from "@/lib/tenant/scope";

import {
  ACTIVATION_CODE_TTL_MS,
  generateActivationCode,
  hashSecret,
  isPlausibleEmail,
  normalizeActivationCode,
  normalizeEmail,
} from "./credentials";
import { sendInvitationEmail } from "./emails";
import { credentialCompany } from "./lookup";
import { revokeEmployeeAccess } from "./revoke";

/**
 * Employee accounts from HR's side (W2-01, docs/employee-accounts.md):
 * invite by email, issue an activation code for a person without email,
 * disable. Every function takes the company of the HR session first.
 */

export const EMPLOYEE_ACCOUNT_COPY = {
  personNotFound: "Esta persona no está en la empresa.",
  personInactive:
    "Solo una persona activa puede tener cuenta de empleado. Registra su reingreso primero.",
  curpMissing:
    "Captura una CURP válida en el expediente antes de dar acceso a la persona.",
  emailInvalid: "Ingresa un correo válido.",
  emailTaken:
    "Ese correo ya tiene una cuenta de empleado. Usa otro correo o desactiva la otra cuenta.",
  curpTaken:
    "Esta persona ya tiene una cuenta de empleado en otra empresa del grupo. Desactívala primero.",
  alreadyActive:
    "La persona ya activó su cuenta. Para cambiar su correo, desactívala y vuelve a invitarla.",
  noAccount: "Esta persona no tiene una cuenta activa.",
  emailNotSent:
    "La invitación quedó registrada, pero no pudimos enviar el correo. Genera un código de activación o inténtalo más tarde.",
  denied: "No tienes permiso para administrar cuentas de empleado.",
} as const;

export type EmployeeAccountView = Pick<
  EmployeeAccount,
  | "id"
  | "status"
  | "email"
  | "emailVerifiedAt"
  | "invitedAt"
  | "activatedAt"
  | "lastLoginAt"
  | "disabledAt"
  | "disabledReason"
> & {
  hasPassword: boolean;
  /** Expiry of the activation code HR issued, while it can still be used. */
  activationCodeExpiresAt: Date | null;
};

const lockLivePerson = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
) => {
  const [person] = await tx
    .select({
      id: people.id,
      status: people.status,
      curp: people.curp,
      email: people.email,
    })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .for("update");

  return person ?? null;
};

type PersonCheck =
  { ok: true; curp: string } | { ok: false; error: string; missing?: true };

const checkPersonCanHaveAccount = (
  person: Awaited<ReturnType<typeof lockLivePerson>>,
): PersonCheck => {
  if (!person) {
    return {
      ok: false,
      error: EMPLOYEE_ACCOUNT_COPY.personNotFound,
      missing: true,
    };
  }

  if (person.status !== "activa") {
    return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.personInactive };
  }

  const curp = normalizeCurp(person.curp);

  if (!isValidCurp(curp)) {
    return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.curpMissing };
  }

  return { ok: true, curp };
};

/** Serializes invitations for one CURP or one email, across companies. */
const lockKey = (tx: DbTransaction, key: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

const liveAccount = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
) => {
  const [account] = await tx
    .select()
    .from(employeeAccounts)
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.personId, personId),
        ne(employeeAccounts.status, "disabled"),
      ),
    )
    .for("update");

  return account ?? null;
};

/**
 * The person's account as the expediente shows it: the live one, else the
 * last disabled one. Null when the person never had one (or is not in the
 * company).
 */
export const getEmployeeAccount = async (
  companyId: string,
  personId: string,
): Promise<EmployeeAccountView | null> => {
  const [account] = await tdb(companyId)
    .select()
    .from(employeeAccounts)
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.personId, personId),
      ),
    )
    .orderBy(
      sql`(${employeeAccounts.status} = 'disabled')`,
      desc(employeeAccounts.createdAt),
    )
    .limit(1);

  if (!account) {
    return null;
  }

  const [code] =
    account.status === "disabled"
      ? []
      : await tdb(companyId)
          .select({ expiresAt: employeeCodes.expiresAt })
          .from(employeeCodes)
          .where(
            withTenant(
              employeeCodes,
              companyId,
              eq(employeeCodes.accountId, account.id),
              eq(employeeCodes.purpose, "activation"),
              isNull(employeeCodes.usedAt),
              gt(employeeCodes.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(employeeCodes.createdAt))
          .limit(1);

  return {
    id: account.id,
    status: account.status,
    email: account.email,
    emailVerifiedAt: account.emailVerifiedAt,
    invitedAt: account.invitedAt,
    activatedAt: account.activatedAt,
    lastLoginAt: account.lastLoginAt,
    disabledAt: account.disabledAt,
    disabledReason: account.disabledReason,
    hasPassword: Boolean(account.passwordHash),
    activationCodeExpiresAt: code?.expiresAt ?? null,
  };
};

export type InviteResult =
  | { ok: true; accountId: string; email: string; emailSent: boolean }
  | { ok: false; error: string };

/**
 * Invites the person by email: a new invited account, or the live invited one
 * with this email. The email must not be on a live account of any company,
 * and the CURP must not have a live account in another company. The email
 * goes after the commit; null when the person is not in the company.
 */
export const inviteEmployee = async (
  companyId: string,
  personId: string,
  rawEmail: string,
  actorUserId: string | null,
  options: { origin: string },
): Promise<InviteResult | null> => {
  const email = normalizeEmail(rawEmail);

  if (!isPlausibleEmail(email)) {
    return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailInvalid };
  }

  let result: InviteResult | null;

  try {
    result = await withTransaction(async (tx): Promise<InviteResult | null> => {
      const check = checkPersonCanHaveAccount(
        await lockLivePerson(tx, companyId, personId),
      );

      if (!check.ok) {
        return check.missing ? null : check;
      }

      await lockKey(tx, `employee-curp:${check.curp}`);
      await lockKey(tx, `employee-email:${email}`);

      const live = await liveAccount(tx, companyId, personId);

      if (live?.status === "active") {
        return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.alreadyActive };
      }

      if (
        live?.email !== email &&
        (await credentialCompany("email", email, tx))
      ) {
        return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailTaken };
      }

      if (!live && (await credentialCompany("curp", check.curp, tx))) {
        return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.curpTaken };
      }

      const now = new Date();
      const [account] = live
        ? await tx
            .update(employeeAccounts)
            .set({ email, invitedAt: now, invitedBy: actorUserId })
            .where(
              withTenant(
                employeeAccounts,
                companyId,
                eq(employeeAccounts.id, live.id),
              ),
            )
            .returning()
        : await tx
            .insert(employeeAccounts)
            .values({
              companyId,
              personId,
              email,
              invitedBy: actorUserId,
              invitedAt: now,
            })
            .returning();

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "employee_account",
          resourceId: account.id,
          action: "invite",
          payload: {
            after: { personId, email, status: account.status },
            ...(live && live.email !== email
              ? { changes: { email: { from: live.email, to: email } } }
              : {}),
            summary: `Invitación a la app de empleados enviada a ${email}`,
          },
        },
        tx,
      );

      return { ok: true, accountId: account.id, email, emailSent: false };
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.emailTaken };
    }

    throw error;
  }

  if (!result?.ok) {
    return result;
  }

  try {
    await sendInvitationEmail({ to: email, origin: options.origin });
    return { ...result, emailSent: true };
  } catch (error) {
    logger.error({ err: error, companyId }, "Invitation email failed");
    return result;
  }
};

export type ActivationCodeResult =
  | { ok: true; accountId: string; code: string; expiresAt: Date }
  | { ok: false; error: string };

/**
 * A one-time activation code for the person (W2-01: people without email),
 * shown to HR once. Creates the invited account when there is none; a new
 * code replaces the previous unused one. On an active account it works as a
 * password reset. Null when the person is not in the company.
 */
export const issueActivationCode = async (
  companyId: string,
  personId: string,
  actorUserId: string | null,
): Promise<ActivationCodeResult | null> =>
  withTransaction(async (tx): Promise<ActivationCodeResult | null> => {
    const check = checkPersonCanHaveAccount(
      await lockLivePerson(tx, companyId, personId),
    );

    if (!check.ok) {
      return check.missing ? null : check;
    }

    await lockKey(tx, `employee-curp:${check.curp}`);

    let account = await liveAccount(tx, companyId, personId);

    if (!account) {
      if (await credentialCompany("curp", check.curp, tx)) {
        return { ok: false, error: EMPLOYEE_ACCOUNT_COPY.curpTaken };
      }

      [account] = await tx
        .insert(employeeAccounts)
        .values({ companyId, personId, invitedBy: actorUserId })
        .returning();
    }

    await tx
      .delete(employeeCodes)
      .where(
        withTenant(
          employeeCodes,
          companyId,
          eq(employeeCodes.accountId, account.id),
          eq(employeeCodes.purpose, "activation"),
          isNull(employeeCodes.usedAt),
        ),
      );

    const code = generateActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_MS);

    await tx.insert(employeeCodes).values({
      companyId,
      accountId: account.id,
      purpose: "activation",
      codeHash: hashSecret("activation", normalizeActivationCode(code)),
      expiresAt,
      createdBy: actorUserId,
    });

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "employee_account",
        resourceId: account.id,
        action: "activation_code",
        payload: {
          after: { personId, status: account.status },
          // Never the code itself.
          summary:
            account.status === "active"
              ? "Código para restablecer la contraseña de la app de empleados"
              : "Código de activación de la app de empleados",
        },
      },
      tx,
    );

    return { ok: true, accountId: account.id, code, expiresAt };
  }, companyId);

/**
 * HR turns the person's live account off: sessions and codes go with it.
 * Null when there is no live account in the company.
 */
export const disableEmployeeAccount = async (
  companyId: string,
  personId: string,
  actorUserId: string | null,
): Promise<{ ok: true } | null> =>
  withTransaction(async (tx) => {
    const disabled = await revokeEmployeeAccess(
      tx,
      companyId,
      personId,
      "rrhh",
      actorUserId,
    );

    return disabled > 0 ? { ok: true as const } : null;
  }, companyId);
