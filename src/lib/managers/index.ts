import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbTransaction } from "@/lib/db";
import {
  employeeAccounts,
  managerDelegations,
  managerGrants,
  people,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import { ownScope, type ManagerAccess } from "./scope";

export * from "./scope";

/**
 * Manager grants and delegations (Workia 2.0 W2-07, docs/managers.md). HR
 * gives or takes away the grant from the expediente (employee_accounts:manage);
 * a manager names a backup from /mi/equipo, and HR can end it.
 */

export const MANAGER_COPY = {
  noAccount:
    "La persona necesita una cuenta de empleado activa o invitada para ser jefe en la app.",
  delegateInvalid: "Elige a una persona de la lista.",
  datesInvalid:
    "Revisa las fechas: la suplencia empieza hoy o después y termina el mismo día o después.",
  notManager: "Solo quien tiene el rol de jefe puede nombrar un suplente.",
  delegationNotFound: "Esa suplencia ya no está vigente.",
  denied: "No tienes permiso para administrar cuentas de empleado.",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isIsoDate = (value: string) =>
  ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const liveAccountOf = async (
  executor: DbTransaction | ReturnType<typeof tdb>,
  companyId: string,
  personId: string,
) => {
  const [account] = await executor
    .select({ id: employeeAccounts.id, status: employeeAccounts.status })
    .from(employeeAccounts)
    .innerJoin(
      people,
      and(
        eq(people.companyId, employeeAccounts.companyId),
        eq(people.id, employeeAccounts.personId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.personId, personId),
        ne(employeeAccounts.status, "disabled"),
      ),
    )
    .limit(1);

  return account ?? null;
};

const delegatePerson = alias(people, "delegate_person");
const delegateAccount = alias(employeeAccounts, "delegate_account");

export type DelegationView = {
  id: string;
  delegateAccountId: string;
  delegateName: string;
  startsOn: string;
  endsOn: string;
};

/** Live delegations a manager account has given (not ended, not revoked), by start date. */
export const listDelegationsGiven = async (
  companyId: string,
  managerAccountId: string,
  today = isoToday(),
): Promise<DelegationView[]> => {
  const rows = await tdb(companyId)
    .select({
      id: managerDelegations.id,
      delegateAccountId: managerDelegations.delegateAccountId,
      startsOn: managerDelegations.startsOn,
      endsOn: managerDelegations.endsOn,
      nombres: delegatePerson.nombres,
      apellidoPaterno: delegatePerson.apellidoPaterno,
      apellidoMaterno: delegatePerson.apellidoMaterno,
    })
    .from(managerDelegations)
    .innerJoin(
      delegateAccount,
      and(
        eq(delegateAccount.companyId, managerDelegations.companyId),
        eq(delegateAccount.id, managerDelegations.delegateAccountId),
      ),
    )
    .innerJoin(
      delegatePerson,
      and(
        eq(delegatePerson.companyId, delegateAccount.companyId),
        eq(delegatePerson.id, delegateAccount.personId),
      ),
    )
    .where(
      withTenant(
        managerDelegations,
        companyId,
        eq(managerDelegations.managerAccountId, managerAccountId),
        isNull(managerDelegations.revokedAt),
        gte(managerDelegations.endsOn, today),
      ),
    )
    .orderBy(asc(managerDelegations.startsOn), asc(managerDelegations.id));

  return rows.map((row) => ({
    id: row.id,
    delegateAccountId: row.delegateAccountId,
    delegateName: formatPersonName(row),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }));
};

export type ManagerAdminView = {
  accountId: string;
  grant: { includeIndirect: boolean; grantedAt: Date } | null;
  directReports: number;
  delegations: DelegationView[];
};

/**
 * What the expediente's «Rol de jefe» shows HR: the grant on the person's
 * live account, how many active people report to them and the live
 * delegations. Null when the person has no live account.
 */
export const getManagerAdmin = async (
  companyId: string,
  personId: string,
): Promise<ManagerAdminView | null> => {
  const account = await liveAccountOf(tdb(companyId), companyId, personId);

  if (!account) {
    return null;
  }

  const [[grant], [reports], delegations] = await Promise.all([
    tdb(companyId)
      .select({
        includeIndirect: managerGrants.includeIndirect,
        grantedAt: managerGrants.createdAt,
      })
      .from(managerGrants)
      .where(
        withTenant(
          managerGrants,
          companyId,
          eq(managerGrants.accountId, account.id),
          isNull(managerGrants.revokedAt),
        ),
      )
      .limit(1),
    tdb(companyId)
      .select({ count: sql<number>`count(*)::int` })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          eq(people.managerId, personId),
          eq(people.status, "activa"),
          isNull(people.deletedAt),
          ne(people.id, personId),
        ),
      ),
    listDelegationsGiven(companyId, account.id),
  ]);

  return {
    accountId: account.id,
    grant: grant ?? null,
    directReports: reports?.count ?? 0,
    delegations,
  };
};

export type ManagerResult = { ok: true } | { ok: false; error: string };

/**
 * Gives the person's live account the manager grant, or changes whether it
 * includes indirect reports. Audited. HR only.
 */
export const setManagerGrant = async (
  companyId: string,
  personId: string,
  includeIndirect: boolean,
  actorUserId: string | null,
): Promise<ManagerResult> =>
  withTransaction(async (tx): Promise<ManagerResult> => {
    const account = await liveAccountOf(tx, companyId, personId);

    if (!account) {
      return { ok: false, error: MANAGER_COPY.noAccount };
    }

    const [live] = await tx
      .select()
      .from(managerGrants)
      .where(
        withTenant(
          managerGrants,
          companyId,
          eq(managerGrants.accountId, account.id),
          isNull(managerGrants.revokedAt),
        ),
      )
      .for("update");

    if (live?.includeIndirect === includeIndirect) {
      return { ok: true };
    }

    const [grant] = live
      ? await tx
          .update(managerGrants)
          .set({ includeIndirect })
          .where(
            withTenant(managerGrants, companyId, eq(managerGrants.id, live.id)),
          )
          .returning()
      : await tx
          .insert(managerGrants)
          .values({
            companyId,
            accountId: account.id,
            includeIndirect,
            grantedBy: actorUserId,
          })
          .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "manager_grant",
        resourceId: grant.id,
        action: live ? "update" : "create",
        payload: {
          after: { personId, accountId: account.id, includeIndirect },
          ...(live
            ? {
                changes: {
                  includeIndirect: {
                    from: live.includeIndirect,
                    to: includeIndirect,
                  },
                },
              }
            : {}),
          summary: live
            ? includeIndirect
              ? "Rol de jefe: ahora incluye reportes indirectos"
              : "Rol de jefe: solo reportes directos"
            : "Rol de jefe en la app de empleados",
        },
      },
      tx,
    );

    return { ok: true };
  }, companyId);

/**
 * Ends the manager grants and live delegations of these accounts, inside the
 * caller's transaction: HR's «Quitar rol de jefe», and a disabled account
 * (baja, borrado), whose delegations from or to it stop with it.
 */
export const endManagerAccess = async (
  tx: DbTransaction,
  companyId: string,
  accountIds: string[],
  actorUserId: string | null,
) => {
  if (accountIds.length === 0) {
    return [];
  }

  const now = new Date();
  const revoked = await tx
    .update(managerGrants)
    .set({ revokedAt: now, revokedBy: actorUserId })
    .where(
      withTenant(
        managerGrants,
        companyId,
        inArray(managerGrants.accountId, accountIds),
        isNull(managerGrants.revokedAt),
      ),
    )
    .returning({ id: managerGrants.id, accountId: managerGrants.accountId });

  await tx
    .update(managerDelegations)
    .set({ revokedAt: now, revokedBy: actorUserId })
    .where(
      withTenant(
        managerDelegations,
        companyId,
        isNull(managerDelegations.revokedAt),
        or(
          inArray(managerDelegations.managerAccountId, accountIds),
          inArray(managerDelegations.delegateAccountId, accountIds),
        ),
      ),
    );

  return revoked;
};

/** HR takes the grant away; the account's delegations end with it. Audited. */
export const revokeManagerGrant = async (
  companyId: string,
  personId: string,
  actorUserId: string | null,
): Promise<ManagerResult> =>
  withTransaction(async (tx): Promise<ManagerResult> => {
    const account = await liveAccountOf(tx, companyId, personId);

    if (!account) {
      return { ok: false, error: MANAGER_COPY.noAccount };
    }

    const revoked = await endManagerAccess(
      tx,
      companyId,
      [account.id],
      actorUserId,
    );

    for (const grant of revoked) {
      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "manager_grant",
          resourceId: grant.id,
          action: "revoke",
          payload: {
            after: { personId, accountId: grant.accountId },
            summary: "Rol de jefe retirado",
          },
        },
        tx,
      );
    }

    return { ok: true };
  }, companyId);

export type DelegateCandidate = { accountId: string; name: string };

/**
 * Whom a manager can name as backup: people of the company with a live
 * account who are their direct reports or hold a manager grant themselves.
 * Never the manager.
 */
export const listDelegateCandidates = async (
  access: ManagerAccess,
): Promise<DelegateCandidate[]> => {
  const own = ownScope(access);

  if (!own) {
    return [];
  }

  const rows = await tdb(access.companyId)
    .select({
      accountId: employeeAccounts.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(employeeAccounts)
    .innerJoin(
      people,
      and(
        eq(people.companyId, employeeAccounts.companyId),
        eq(people.id, employeeAccounts.personId),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    )
    .leftJoin(
      managerGrants,
      and(
        eq(managerGrants.companyId, employeeAccounts.companyId),
        eq(managerGrants.accountId, employeeAccounts.id),
        isNull(managerGrants.revokedAt),
      ),
    )
    .where(
      withTenant(
        employeeAccounts,
        access.companyId,
        ne(employeeAccounts.status, "disabled"),
        ne(employeeAccounts.id, access.accountId),
        or(
          eq(people.managerId, own.managerPersonId),
          sql`${managerGrants.id} IS NOT NULL`,
        ),
      ),
    )
    .orderBy(
      asc(people.apellidoPaterno),
      asc(people.nombres),
      asc(employeeAccounts.id),
    )
    .limit(200);

  return rows.map((row) => ({
    accountId: row.accountId,
    name: formatPersonName(row),
  }));
};

/**
 * The manager names a backup for some days (from /mi/equipo). The delegate
 * must be one of listDelegateCandidates, read again here; dates are Mexico
 * dates, from today on. Audited with the employee as the actor.
 */
export const createDelegation = async (
  access: ManagerAccess,
  input: { delegateAccountId: string; startsOn: string; endsOn: string },
  today = isoToday(),
): Promise<ManagerResult> => {
  const own = ownScope(access);

  if (!own) {
    return { ok: false, error: MANAGER_COPY.notManager };
  }

  const { delegateAccountId, startsOn, endsOn } = input;

  if (
    !isIsoDate(startsOn) ||
    !isIsoDate(endsOn) ||
    startsOn < today ||
    endsOn < startsOn
  ) {
    return { ok: false, error: MANAGER_COPY.datesInvalid };
  }

  const candidates = await listDelegateCandidates(access);

  if (
    !candidates.some((candidate) => candidate.accountId === delegateAccountId)
  ) {
    return { ok: false, error: MANAGER_COPY.delegateInvalid };
  }

  return withTransaction(async (tx): Promise<ManagerResult> => {
    const [delegation] = await tx
      .insert(managerDelegations)
      .values({
        companyId: access.companyId,
        managerAccountId: access.accountId,
        delegateAccountId,
        startsOn,
        endsOn,
      })
      .returning();

    await recordAuditEvent(
      {
        companyId: access.companyId,
        actorEmployeeAccountId: access.accountId,
        source: "employee",
        resourceType: "manager_delegation",
        resourceId: delegation.id,
        action: "create",
        payload: {
          after: {
            managerAccountId: access.accountId,
            delegateAccountId,
            startsOn,
            endsOn,
          },
          summary: `Suplente de jefe del ${startsOn} al ${endsOn}`,
        },
      },
      tx,
    );

    return { ok: true };
  }, access.companyId);
};

/**
 * Ends a live delegation early. The manager can end their own (actor
 * `{ accountId }`), HR any of the company (`{ userId }`). Audited.
 */
export const cancelDelegation = async (
  companyId: string,
  delegationId: string,
  actor: { accountId: string } | { userId: string },
  today = isoToday(),
): Promise<ManagerResult> =>
  withTransaction(async (tx): Promise<ManagerResult> => {
    const byManager = "accountId" in actor;
    const [delegation] = await tx
      .update(managerDelegations)
      .set({
        revokedAt: new Date(),
        revokedBy: byManager ? null : actor.userId,
      })
      .where(
        withTenant(
          managerDelegations,
          companyId,
          eq(managerDelegations.id, delegationId),
          isNull(managerDelegations.revokedAt),
          gte(managerDelegations.endsOn, today),
          byManager
            ? eq(managerDelegations.managerAccountId, actor.accountId)
            : undefined,
        ),
      )
      .returning();

    if (!delegation) {
      return { ok: false, error: MANAGER_COPY.delegationNotFound };
    }

    await recordAuditEvent(
      {
        companyId,
        ...(byManager
          ? {
              actorEmployeeAccountId: actor.accountId,
              source: "employee" as const,
            }
          : { actorUserId: actor.userId }),
        resourceType: "manager_delegation",
        resourceId: delegation.id,
        action: "revoke",
        payload: {
          after: {
            managerAccountId: delegation.managerAccountId,
            delegateAccountId: delegation.delegateAccountId,
            startsOn: delegation.startsOn,
            endsOn: delegation.endsOn,
          },
          summary: "Suplencia de jefe terminada antes de tiempo",
        },
      },
      tx,
    );

    return { ok: true };
  }, companyId);
