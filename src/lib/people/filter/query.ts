/**
 * The SQL of the Personas filter: one WHERE for the list, its counts and the
 * export, so the file always has the rows the list shows (E4). Always scoped
 * by company. Subqueries are plain SQL with their own company filter: the
 * RLS-scoped client cannot be nested (see personInRegion).
 */

import {
  and,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { escapeLike } from "@/lib/db/like";
import { people, sites } from "@/lib/db/schema";
import { personSearchText, type PersonStatus } from "@/lib/db/schema/people";
import { isoToday } from "@/lib/format/date";

import { PEOPLE_FILTER_FIELDS, type PeopleFilterFieldId } from "./fields";
import type { PeopleFilter, PeopleFilterCondition } from "./schema";

/** Levels below a manager that «incluir todo el equipo» walks at most. */
export const TEAM_MAX_DEPTH = 20;

export type PeopleFilterContext = {
  /** Mexico's calendar date: contract status and «vence en N días» count from it. */
  today: string;
  /** The user's permissions: a field that needs one they lack is ignored. */
  permissions: ReadonlySet<string>;
};

export const peopleFilterContext = (
  permissions: ReadonlySet<string>,
  today = isoToday(),
): PeopleFilterContext => ({ today, permissions });

type FieldSqlArgs = { companyId: string; today: string };
type FieldSql = (
  condition: PeopleFilterCondition,
  args: FieldSqlArgs,
) => SQL | undefined;

const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** is / is not / empty / not empty on a nullable column. */
const nullableColumn =
  (column: AnyPgColumn): FieldSql =>
  (condition) => {
    const values = condition.values ?? [];

    switch (condition.op) {
      case "is":
        return inArray(column, values);
      case "is_not":
        return or(isNull(column), notInArray(column, values));
      case "empty":
        return isNull(column);
      case "not_empty":
        return isNotNull(column);
      default:
        return undefined;
    }
  };

const dateColumn =
  (column: AnyPgColumn | SQL): FieldSql =>
  (condition, { today }) => {
    switch (condition.op) {
      case "between":
        return sql`${column} between ${condition.from}::date and ${condition.to}::date`;
      case "before":
        return sql`${column} < ${condition.from}::date`;
      case "after":
        return sql`${column} > ${condition.from}::date`;
      case "next_days":
        return sql`${column} between ${today}::date and ${today}::date + ${condition.days}::int`;
      case "empty":
        return isNull(column);
      case "not_empty":
        return isNotNull(column);
      default:
        return undefined;
    }
  };

/** Sites of the company in any of `regionIds` (or, with null, in any region). */
const sitesInRegions = (companyId: string, regionIds: string[] | null) =>
  sql`${people.siteId} in (select ${sites.id} from ${sites} where ${sites.companyId} = ${companyId} and ${
    regionIds
      ? sql`${sites.regionId} in (${list(regionIds)})`
      : sql`${sites.regionId} is not null`
  })`;

/**
 * Everyone below `managerIds` in the company, at any level up to
 * TEAM_MAX_DEPTH. The path stops a cycle (A → B → A) from looping or from
 * putting a manager in their own team.
 */
const teamOf = (companyId: string, managerIds: string[]) =>
  sql`${people.id} in (
    with recursive team(id, root, path) as (
      select p.id, p.manager_id, array[p.id]
      from people p
      where p.company_id = ${companyId} and p.manager_id in (${list(managerIds)}) and p.id <> p.manager_id
      union all
      select p.id, t.root, t.path || p.id
      from people p
      join team t on p.manager_id = t.id
      where p.company_id = ${companyId}
        and cardinality(t.path) < ${TEAM_MAX_DEPTH}
        and p.id <> t.root
        and not p.id = any(t.path)
    )
    select id from team
  )`;

/** A live contract of the person (correlated with the outer `people`). */
const contractExists = (companyId: string, condition: SQL) =>
  sql`exists (select 1 from contracts c where c.company_id = ${companyId} and c.person_id = ${people.id} and c.deleted_at is null and ${condition})`;

/**
 * In force on `today`: status vigente and not past its end. Every other
 * status (renovado, no_renovado, vencido, and any added later such as
 * terminado) is not in force; nothing here lists them, so a new one cannot
 * break the filter.
 */
const inForce = (today: string) =>
  sql`c.status = 'vigente' and (c.end_date is null or c.end_date >= ${today}::date)`;

const contractStates = ({ companyId, today }: FieldSqlArgs) =>
  new Map<string, SQL>([
    ["vigente", contractExists(companyId, inForce(today))],
    [
      "vencido",
      sql`(not ${contractExists(companyId, inForce(today))} and ${contractExists(companyId, sql`true`)})`,
    ],
    ["sin_contrato", sql`not ${contractExists(companyId, sql`true`)}`],
  ]);

/**
 * The current (or last) employment period of the outer person, as
 * summarizePeriods() (@/lib/people/employment) picks it: the open one (no
 * fecha_baja and not «sin fecha»), else the latest by ingreso, then by when
 * it was recorded. One lookup on employment_periods_person_id_idx per person.
 */
const currentPeriod = (companyId: string) => sql`(
  select e.* from employment_periods e
  where e.company_id = ${companyId} and e.person_id = ${people.id}
  order by (e.fecha_baja is null and not e.baja_sin_fecha) desc, e.fecha_ingreso desc nulls last, e.created_at desc
  limit 1
)`;

/** `condition` (on `ep.…`) holds for the current period; false without periods. */
const inCurrentPeriod = (companyId: string, condition: SQL) =>
  sql`exists (select 1 from ${currentPeriod(companyId)} ep where ${condition})`;

/** One column (`ep.…`) of the current period; null without periods. */
export const currentPeriodValue = (companyId: string, column: SQL) =>
  sql`(select ${column} from ${currentPeriod(companyId)} ep)`;

/**
 * The seniority date: the stored fecha_antiguedad of the current period
 * (seniorityDate() of Iniciativa 2), people.fecha_ingreso without periods.
 */
const seniorityDateSql = (companyId: string) =>
  sql`coalesce(${currentPeriodValue(companyId, sql`ep.fecha_antiguedad`)}, ${people.fechaIngreso})`;

/**
 * The day seniority counts up to: today, or the fecha de baja of a person de
 * baja (as the constancia de antigüedad does).
 */
const seniorityUntilSql = (companyId: string, today: string) =>
  sql`(case when ${people.status} = 'baja' then least(coalesce(${currentPeriodValue(companyId, sql`ep.fecha_baja`)}, ${today}::date), ${today}::date) else ${today}::date end)`;

/**
 * Fecha de baja: the current period's, and only people de baja. The IN over
 * (company_id, fecha_baja) lets a narrow range start from that index; the
 * current-period check keeps an older baja of a rehired person out.
 */
const fechaBajaSql: FieldSql = (condition, args) => {
  const { companyId } = args;
  const onPeriod = dateColumn(sql`ep.fecha_baja`)(condition, args);

  if (!onPeriod) return undefined;

  const ranged =
    condition.op === "between" ||
    condition.op === "before" ||
    condition.op === "after";

  return and(
    eq(people.status, "baja"),
    ranged
      ? sql`${people.id} in (select ep.person_id from employment_periods ep where ep.company_id = ${companyId} and ${onPeriod})`
      : undefined,
    condition.op === "empty"
      ? not(inCurrentPeriod(companyId, sql`ep.fecha_baja is not null`))
      : inCurrentPeriod(companyId, onPeriod),
  );
};

const REVIEW_FLAGS: Record<string, SQL> = {
  sin_fecha: sql`e.baja_sin_fecha`,
  inferida: sql`e.fecha_baja_inferida`,
  revision: sql`e.requiere_revision`,
};

/** Any period of the person (not only the current one) carries a review flag. */
export const periodFlagged = (companyId: string, flag: string) => {
  const column = REVIEW_FLAGS[flag];
  return column
    ? sql`exists (select 1 from employment_periods e where e.company_id = ${companyId} and e.person_id = ${people.id} and ${column})`
    : undefined;
};

const MISSING_IDENTIFIER: Record<string, AnyPgColumn> = {
  curp: people.curp,
  nss: people.nss,
  rfc: people.rfc,
};

/**
 * The SQL of each field. A field added to PEOPLE_FILTER_FIELDS without an
 * entry here does not compile.
 */
const FIELD_SQL: Record<PeopleFilterFieldId, FieldSql> = {
  relacion: (condition) => {
    const values = (condition.values ?? []) as PersonStatus[];
    return condition.op === "is_not"
      ? notInArray(people.status, values)
      : inArray(people.status, values);
  },
  region: (condition, { companyId }) => {
    const values = condition.values ?? [];

    switch (condition.op) {
      case "is":
        return sitesInRegions(companyId, values);
      case "is_not":
        return or(
          isNull(people.siteId),
          not(sitesInRegions(companyId, values)),
        );
      case "empty":
        return or(isNull(people.siteId), not(sitesInRegions(companyId, null)));
      case "not_empty":
        return sitesInRegions(companyId, null);
      default:
        return undefined;
    }
  },
  area: nullableColumn(people.areaId),
  puesto: nullableColumn(people.positionId),
  sucursal: nullableColumn(people.siteId),
  jefe: (condition, args) => {
    const values = condition.values ?? [];

    if (condition.team && condition.op === "is") {
      return teamOf(args.companyId, values);
    }

    if (condition.team && condition.op === "is_not") {
      return not(teamOf(args.companyId, values));
    }

    return nullableColumn(people.managerId)(condition, args);
  },
  ingreso: dateColumn(people.fechaIngreso),
  antiguedad: (condition, args) => {
    const { companyId, today } = args;
    const since = seniorityDateSql(companyId);

    if (condition.op === "min_years" || condition.op === "max_years") {
      // N years completed on the day it counts up to, like seniorityParts().
      const threshold = sql`(${seniorityUntilSql(companyId, today)} - make_interval(years => ${condition.years}::int))::date`;
      return condition.op === "min_years"
        ? sql`${since} <= ${threshold}`
        : sql`${since} > ${threshold}`;
    }

    return dateColumn(since)(condition, args);
  },
  baja: fechaBajaSql,
  tipoBaja: (condition, { companyId }) => {
    const typed = inCurrentPeriod(
      companyId,
      sql`ep.tipo_baja::text in (${list(condition.values ?? [])})`,
    );
    return condition.op === "is_not" ? not(typed) : typed;
  },
  motivoBaja: (condition, { companyId }) => {
    // Scoped by the period's company: another company's reason matches nothing.
    const values = list(condition.values ?? []);
    const reason = inCurrentPeriod(
      companyId,
      sql`ep.motivo_baja_id in (${values})`,
    );

    if (condition.op === "is_not") return not(reason);

    // Starts from employment_periods_motivo_baja_id_idx, like Fecha de baja.
    return and(
      sql`${people.id} in (select ep.person_id from employment_periods ep where ep.company_id = ${companyId} and ep.motivo_baja_id in (${values}))`,
      reason,
    );
  },
  recontratable: (condition, { companyId }) => {
    const values = condition.values ?? [];
    const accepted = [
      ...(values.includes("si") ? [sql`ep.recontratable`] : []),
      ...(values.includes("no") ? [sql`not ep.recontratable`] : []),
    ];

    return accepted.length > 0
      ? inCurrentPeriod(companyId, or(...accepted)!)
      : undefined;
  },
  revisionBaja: (condition, { companyId }) =>
    or(
      ...(condition.values ?? []).map((value) =>
        periodFlagged(companyId, value),
      ),
    ),
  tipoContrato: (condition, { companyId, today }) => {
    const typed = contractExists(
      companyId,
      sql`${inForce(today)} and c.type in (${list(condition.values ?? [])})`,
    );
    return condition.op === "is_not" ? not(typed) : typed;
  },
  contrato: (condition, args) => {
    const states = contractStates(args);
    const any = or(
      ...(condition.values ?? []).map((value) => states.get(value)),
    );

    if (!any) return undefined;

    return condition.op === "is_not" ? not(any) : any;
  },
  // The same contracts as listExpiringContracts (Contratos, MCP): determinado,
  // vigente, ending between today and today + N, whatever the notice window.
  vence: (condition, { companyId, today }) =>
    contractExists(
      companyId,
      sql`c.status = 'vigente' and c.type = 'determinado' and c.end_date >= ${today}::date and c.end_date <= ${today}::date + ${condition.days}::int`,
    ),
  incompletos: (condition) =>
    or(
      ...(condition.values ?? []).flatMap((value) => {
        const column = MISSING_IDENTIFIER[value];
        return column ? [sql`coalesce(${column}, '') = ''`] : [];
      }),
    ),
};

/** Every word must appear somewhere in name/RFC/CURP/email (the list's search). */
export const peopleTextSearch = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => ilike(personSearchText(people), `%${escapeLike(term)}%`));

/**
 * The WHERE of a Personas filter in `companyId`. `omit` leaves one field out
 * (its option counts are computed against the other conditions).
 */
export const buildPeopleWhere = (
  companyId: string,
  filter: PeopleFilter,
  context: PeopleFilterContext,
  options: { omit?: PeopleFilterFieldId } = {},
) => {
  const args = { companyId, today: context.today };
  const conditions = filter.conditions.flatMap((condition) => {
    const field = PEOPLE_FILTER_FIELDS[condition.field];

    if (condition.field === options.omit) return [];
    // Enforced here, not only in the UI: no permission, no condition.
    if (field.permission && !context.permissions.has(field.permission)) {
      return [];
    }

    const where = FIELD_SQL[condition.field](condition, args);
    return where ? [where] : [];
  });

  return and(
    eq(people.companyId, companyId),
    filter.deleted ? isNotNull(people.deletedAt) : isNull(people.deletedAt),
    ...peopleTextSearch(filter.q),
    ...conditions,
  ) as SQL;
};
