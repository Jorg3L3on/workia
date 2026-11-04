import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { tdb } from "@/lib/db";
import {
  areas,
  employeeAccounts,
  managerDelegations,
  managerGrants,
  people,
  positions,
  sites,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { isoToday } from "@/lib/format/date";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

/**
 * Manager scope (Workia 2.0 W2-07, docs/managers.md). What a signed-in
 * employee may see and decide as a manager, resolved on every request from
 * their grant and their live delegations. The team is read live from
 * people.manager_id: never stored, never from employment_periods.
 */

/** One manager the account acts for: itself, or a manager it covers for. */
export type ManagerScope = {
  managerAccountId: string;
  managerPersonId: string;
  managerName: string;
  includeIndirect: boolean;
  via: "own" | "delegation";
  /** Last day of the delegation (Mexico date), for via = "delegation". */
  endsOn: string | null;
};

export type ManagerAccess = {
  companyId: string;
  accountId: string;
  personId: string;
  /** Own grant first, then delegations by end date. Never empty. */
  scopes: ManagerScope[];
};

/** How deep an indirect team goes: plenty for an org chart, and a stop for a cycle in manager_id. */
export const MAX_TEAM_DEPTH = 10;

const managerPerson = alias(people, "manager_person");

/**
 * The manager access of a signed-in employee, or null when they have no live
 * grant and cover for nobody today. `today` is the Mexico date; a delegation
 * counts from starts_on through ends_on.
 */
export const getManagerAccess = async (
  context: Pick<EmployeeContext, "accountId" | "companyId" | "personId">,
  today = isoToday(),
): Promise<ManagerAccess | null> => {
  const { companyId, accountId } = context;
  const database = tdb(companyId);

  const [own, delegated] = await Promise.all([
    database
      .select({
        includeIndirect: managerGrants.includeIndirect,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
      })
      .from(managerGrants)
      .innerJoin(
        people,
        and(
          eq(people.companyId, managerGrants.companyId),
          eq(people.id, context.personId),
        ),
      )
      .where(
        withTenant(
          managerGrants,
          companyId,
          eq(managerGrants.accountId, accountId),
          isNull(managerGrants.revokedAt),
        ),
      )
      .limit(1),
    database
      .select({
        managerAccountId: managerDelegations.managerAccountId,
        managerPersonId: employeeAccounts.personId,
        includeIndirect: managerGrants.includeIndirect,
        endsOn: managerDelegations.endsOn,
        nombres: managerPerson.nombres,
        apellidoPaterno: managerPerson.apellidoPaterno,
        apellidoMaterno: managerPerson.apellidoMaterno,
      })
      .from(managerDelegations)
      .innerJoin(
        employeeAccounts,
        and(
          eq(employeeAccounts.companyId, managerDelegations.companyId),
          eq(employeeAccounts.id, managerDelegations.managerAccountId),
          ne(employeeAccounts.status, "disabled"),
        ),
      )
      .innerJoin(
        managerGrants,
        and(
          eq(managerGrants.companyId, managerDelegations.companyId),
          eq(managerGrants.accountId, managerDelegations.managerAccountId),
          isNull(managerGrants.revokedAt),
        ),
      )
      .innerJoin(
        managerPerson,
        and(
          eq(managerPerson.companyId, employeeAccounts.companyId),
          eq(managerPerson.id, employeeAccounts.personId),
          eq(managerPerson.status, "activa"),
          isNull(managerPerson.deletedAt),
        ),
      )
      .where(
        withTenant(
          managerDelegations,
          companyId,
          eq(managerDelegations.delegateAccountId, accountId),
          isNull(managerDelegations.revokedAt),
          lte(managerDelegations.startsOn, today),
          gte(managerDelegations.endsOn, today),
        ),
      )
      .orderBy(asc(managerDelegations.endsOn)),
  ]);

  const scopes: ManagerScope[] = [];

  if (own[0]) {
    scopes.push({
      managerAccountId: accountId,
      managerPersonId: context.personId,
      managerName: formatPersonName(own[0]),
      includeIndirect: own[0].includeIndirect,
      via: "own",
      endsOn: null,
    });
  }

  for (const row of delegated) {
    if (
      scopes.some((scope) => scope.managerAccountId === row.managerAccountId)
    ) {
      continue;
    }

    scopes.push({
      managerAccountId: row.managerAccountId,
      managerPersonId: row.managerPersonId,
      managerName: formatPersonName(row),
      includeIndirect: row.includeIndirect,
      via: "delegation",
      endsOn: row.endsOn,
    });
  }

  return scopes.length > 0
    ? {
        companyId,
        accountId,
        personId: context.personId,
        scopes,
      }
    : null;
};

/** The account's own grant, when it has one (delegations aside). */
export const ownScope = (access: ManagerAccess) =>
  access.scopes.find((scope) => scope.via === "own") ?? null;

/**
 * The managers whose approvals this account decides: itself and whoever it
 * covers for today. A request stores its approver (the requester's
 * manager_id when it is created); the inbox lists requests whose approver is
 * one of these. Indirect scope widens what the manager sees, not what they
 * approve.
 */
export const approverPersonIds = (access: ManagerAccess) =>
  access.scopes.map((scope) => scope.managerPersonId);

export const canDecideFor = (access: ManagerAccess, approverPersonId: string) =>
  approverPersonIds(access).includes(approverPersonId);

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * `people.id` is in the access's team: active, live people of the company
 * whose manager_id is one of the scopes' managers, plus their reports down to
 * MAX_TEAM_DEPTH for scopes with indirect enabled. The managers themselves
 * are never in it (a cycle in manager_id would put them there).
 */
export const teamCondition = (access: ManagerAccess): SQL => {
  const direct = access.scopes
    .filter((scope) => !scope.includeIndirect)
    .map((scope) => scope.managerPersonId);
  const indirect = access.scopes
    .filter((scope) => scope.includeIndirect)
    .map((scope) => scope.managerPersonId);
  const managers = access.scopes.map((scope) => scope.managerPersonId);

  const branches: SQL[] = [];

  if (direct.length > 0) {
    branches.push(inArray(people.managerId, direct));
  }

  if (indirect.length > 0) {
    // Walks live rows (a baja in the middle still links their reports) and
    // filters active people at the end, like the direct branch.
    branches.push(sql`${people.id} IN (
      WITH RECURSIVE team (id, depth) AS (
        SELECT p.id, 1 FROM people p
        WHERE p.company_id = ${access.companyId}::uuid
          AND p.manager_id IN (${uuidList(indirect)})
          AND p.deleted_at IS NULL
        UNION
        SELECT p.id, team.depth + 1 FROM people p
        JOIN team ON p.manager_id = team.id
        WHERE p.company_id = ${access.companyId}::uuid
          AND p.deleted_at IS NULL
          AND team.depth < ${MAX_TEAM_DEPTH}
      )
      SELECT id FROM team
    )`);
  }

  return and(
    eq(people.companyId, access.companyId),
    eq(people.status, "activa"),
    isNull(people.deletedAt),
    sql`${people.id} NOT IN (${uuidList(managers)})`,
    or(...branches),
  ) as SQL;
};

/** Whether a person is in the access's team right now: the IDOR gate of every team screen. */
export const isInTeam = async (access: ManagerAccess, personId: string) => {
  const [row] = await tdb(access.companyId)
    .select({ id: people.id })
    .from(people)
    .where(and(teamCondition(access), eq(people.id, personId)))
    .limit(1);

  return Boolean(row);
};

// Team list: name order, keyset pages (no OFFSET, docs/keyset.md).
const sortName = sql<string>`lower(concat_ws(' ', ${people.apellidoPaterno}, ${people.apellidoMaterno}, ${people.nombres}))`;

export const TEAM_PAGE_SIZE = 50;

type TeamCursor = { name: string; id: string };

export const encodeTeamCursor = (cursor: TeamCursor) =>
  Buffer.from(JSON.stringify([cursor.name, cursor.id])).toString("base64url");

/** An unreadable cursor (old link, tampered value) starts the list over. */
export const decodeTeamCursor = (value?: string | null): TeamCursor | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { name: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to a fresh start.
  }

  return null;
};

export type TeamMember = {
  id: string;
  name: string;
  positionName: string | null;
  areaName: string | null;
  siteName: string | null;
  /** Whom they report to, when it is not the signed-in manager (indirect or delegated scope). */
  managerName: string | null;
  managerId: string | null;
};

/**
 * One page of the team in name order. `cursor` is the `next` of the previous
 * page; `next` is null on the last page.
 */
export const listTeam = async (
  access: ManagerAccess,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ items: TeamMember[]; next: string | null }> => {
  const limit = Math.min(Math.max(options.limit ?? TEAM_PAGE_SIZE, 1), 200);
  const after = decodeTeamCursor(options.cursor);

  const rows = await tdb(access.companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      positionName: positions.name,
      areaName: areas.name,
      siteName: sites.name,
      managerId: people.managerId,
      managerNombres: managerPerson.nombres,
      managerApellidoPaterno: managerPerson.apellidoPaterno,
      managerApellidoMaterno: managerPerson.apellidoMaterno,
      sortName,
    })
    .from(people)
    .leftJoin(
      positions,
      and(
        eq(positions.companyId, people.companyId),
        eq(positions.id, people.positionId),
      ),
    )
    .leftJoin(
      areas,
      and(eq(areas.companyId, people.companyId), eq(areas.id, people.areaId)),
    )
    .leftJoin(
      sites,
      and(eq(sites.companyId, people.companyId), eq(sites.id, people.siteId)),
    )
    .leftJoin(
      managerPerson,
      and(
        eq(managerPerson.companyId, people.companyId),
        eq(managerPerson.id, people.managerId),
      ),
    )
    .where(
      and(
        teamCondition(access),
        after
          ? sql`(${sortName}, ${people.id}) > (${after.name}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(sortName, asc(people.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      name: formatPersonName(row),
      positionName: row.positionName,
      areaName: row.areaName,
      siteName: row.siteName,
      managerId: row.managerId,
      managerName:
        row.managerId && row.managerId !== access.personId && row.managerNombres
          ? formatPersonName({
              nombres: row.managerNombres,
              apellidoPaterno: row.managerApellidoPaterno ?? "",
              apellidoMaterno: row.managerApellidoMaterno,
            })
          : null,
    })),
    next:
      rows.length > limit && last
        ? encodeTeamCursor({ name: last.sortName, id: last.id })
        : null,
  };
};

/** One team member for /mi/equipo/[id], or null when they are not in the team (a 404). */
export const getTeamMember = async (
  access: ManagerAccess,
  personId: string,
) => {
  const [row] = await tdb(access.companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      fechaIngreso: people.fechaIngreso,
      positionName: positions.name,
      areaName: areas.name,
      siteName: sites.name,
      managerId: people.managerId,
      managerNombres: managerPerson.nombres,
      managerApellidoPaterno: managerPerson.apellidoPaterno,
      managerApellidoMaterno: managerPerson.apellidoMaterno,
    })
    .from(people)
    .leftJoin(
      positions,
      and(
        eq(positions.companyId, people.companyId),
        eq(positions.id, people.positionId),
      ),
    )
    .leftJoin(
      areas,
      and(eq(areas.companyId, people.companyId), eq(areas.id, people.areaId)),
    )
    .leftJoin(
      sites,
      and(eq(sites.companyId, people.companyId), eq(sites.id, people.siteId)),
    )
    .leftJoin(
      managerPerson,
      and(
        eq(managerPerson.companyId, people.companyId),
        eq(managerPerson.id, people.managerId),
      ),
    )
    .where(and(teamCondition(access), eq(people.id, personId)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: formatPersonName(row),
    fechaIngreso: row.fechaIngreso,
    positionName: row.positionName,
    areaName: row.areaName,
    siteName: row.siteName,
    managerName: row.managerNombres
      ? formatPersonName({
          nombres: row.managerNombres,
          apellidoPaterno: row.managerApellidoPaterno ?? "",
          apellidoMaterno: row.managerApellidoMaterno,
        })
      : null,
  };
};

export type TeamMemberDetail = NonNullable<
  Awaited<ReturnType<typeof getTeamMember>>
>;

/**
 * Who approves a person's request right now: their live manager_id, when that
 * manager has a live grant on a live account. W2-06 stores it on the request
 * when it is created; null means the request goes to HR.
 */
export const currentApprover = async (companyId: string, personId: string) => {
  const [row] = await tdb(companyId)
    .select({ managerPersonId: managerPerson.id })
    .from(people)
    .innerJoin(
      managerPerson,
      and(
        eq(managerPerson.companyId, people.companyId),
        eq(managerPerson.id, people.managerId),
        eq(managerPerson.status, "activa"),
        isNull(managerPerson.deletedAt),
      ),
    )
    .innerJoin(
      employeeAccounts,
      and(
        eq(employeeAccounts.companyId, managerPerson.companyId),
        eq(employeeAccounts.personId, managerPerson.id),
        ne(employeeAccounts.status, "disabled"),
      ),
    )
    .innerJoin(
      managerGrants,
      and(
        eq(managerGrants.companyId, employeeAccounts.companyId),
        eq(managerGrants.accountId, employeeAccounts.id),
        isNull(managerGrants.revokedAt),
      ),
    )
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  return row?.managerPersonId ?? null;
};

export type TeamPlace = { kind: "site" | "area"; id: string; name: string };

/**
 * The sites and areas the team works in, by name: the filters of the today
 * view (W2-17). One grouped pass over the team's people rows.
 */
export const listTeamPlaces = async (
  access: ManagerAccess,
): Promise<TeamPlace[]> => {
  const rows = await tdb(access.companyId)
    .select({
      siteId: sites.id,
      siteName: sites.name,
      areaId: areas.id,
      areaName: areas.name,
    })
    .from(people)
    .leftJoin(
      areas,
      and(eq(areas.companyId, people.companyId), eq(areas.id, people.areaId)),
    )
    .leftJoin(
      sites,
      and(eq(sites.companyId, people.companyId), eq(sites.id, people.siteId)),
    )
    .where(teamCondition(access))
    .groupBy(sites.id, sites.name, areas.id, areas.name);

  const places = new Map<string, TeamPlace>();

  for (const row of rows) {
    if (row.siteId && row.siteName) {
      places.set(`site:${row.siteId}`, {
        kind: "site",
        id: row.siteId,
        name: row.siteName,
      });
    }
    if (row.areaId && row.areaName) {
      places.set(`area:${row.areaId}`, {
        kind: "area",
        id: row.areaId,
        name: row.areaName,
      });
    }
  }

  return [...places.values()].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "site" ? -1 : 1) ||
      a.name.localeCompare(b.name, "es"),
  );
};
