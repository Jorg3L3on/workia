import { sql, type SQL } from "drizzle-orm";

import { type DbExecutor, tdb } from "@/lib/db";

/**
 * The numbers the app shows, computed when read (Workia 2.0 P-02,
 * docs/aggregates.md). Every helper is one statement over person_events
 * through an index: the company's people (or one site's), then one range
 * scan of person_events_person_time_idx per person. There
 * are no counters, triggers or reconciliation jobs. The one stored summary is
 * the snapshot a pay period freezes when it closes (src/lib/pay-periods),
 * built from the same SQL as incidenciasBy.
 *
 * Record shapes these helpers read (written by W2-12 and W2-14):
 * - attendance: one row per person per day, day = the dedupe key's date.
 * - incidencia: payload.date ('YYYY-MM-DD', the local day), payload.kind
 *   (falta, retardo, salida_anticipada, ...), payload.minutes,
 *   payload.justified. The table is append-only, so a
 *   correction is a new event with the same date and kind, the full payload
 *   and a higher payload.rev; the highest rev wins, and payload.voided: true
 *   cancels that incidencia.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** The longest range one aggregate reads: a year and a bit, for a report by month. */
export const MAX_AGGREGATE_DAYS = 400;

/** Local days, both ends included: 'YYYY-MM-DD'. */
export type DayRange = { from: string; to: string };

export type AggregateGroup = "person" | "site" | "month";

export type AggregateOptions = {
  /** What each row adds up: one person, one site (the person's people.site_id) or one month ('YYYY-MM'). */
  by: AggregateGroup;
  /** Only the people of this site (people.site_id). */
  siteId?: string;
  /** Only these people: read through the person index. */
  personIds?: string[];
  executor?: DbExecutor;
};

export class AggregateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateRangeError";
  }
}

const parseDay = (day: string) => {
  const parsed = new Date(`${day}T00:00:00Z`);

  if (!DAY.test(day) || Number.isNaN(parsed.getTime())) {
    throw new AggregateRangeError(`Fecha inválida: ${day}`);
  }

  if (parsed.toISOString().slice(0, 10) !== day) {
    throw new AggregateRangeError(`Fecha inválida: ${day}`);
  }

  return parsed;
};

/**
 * The occurred_at window that holds every event of the local days in range:
 * a day earlier and a day later than UTC, so any Mexican time zone fits. The
 * index narrows by this window; the local day then decides.
 */
const windowOf = (range: DayRange) => {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  const days = (to.getTime() - from.getTime()) / DAY_MS + 1;

  if (days < 1) {
    throw new AggregateRangeError("La fecha final es anterior a la inicial.");
  }

  if (days > MAX_AGGREGATE_DAYS) {
    throw new AggregateRangeError(
      `El rango es de ${days} días; el máximo es ${MAX_AGGREGATE_DAYS}.`,
    );
  }

  return {
    lo: new Date(from.getTime() - DAY_MS),
    hi: new Date(to.getTime() + 2 * DAY_MS),
  };
};

type Scope = { siteId?: string; personIds?: string[] };

/** Nothing can match: a bad id is not an error, it is an empty answer. */
const isEmptyScope = (scope: Scope) =>
  (scope.siteId !== undefined && !UUID.test(scope.siteId)) ||
  (scope.personIds !== undefined &&
    (scope.personIds.length === 0 ||
      scope.personIds.some((id) => !UUID.test(id))));

/**
 * The rows of one type in range, as (person_id, site_id, day, payload,
 * occurred_at, id). It starts from the company's people (all of them, one
 * site's through people_site_id_idx, or the given ids) and reads each one's
 * window with one range scan of person_events_person_time_idx, so years of
 * history are never read and no index of its own is needed. The site is the
 * person's site in people, as in the today view (P-04).
 */
const scopedEvents = (
  companyId: string,
  type: "attendance" | "incidencia",
  range: DayRange,
  scope: Scope,
): SQL => {
  const { lo, hi } = windowOf(range);
  const day =
    type === "attendance"
      ? sql.raw(`substr(e.dedupe_key, 12)`)
      : sql.raw(`(e.payload ->> 'date')`);
  const dayFilter =
    type === "incidencia"
      ? sql`and e.payload ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`
      : sql``;
  const site = scope.siteId ? sql`and p.site_id = ${scope.siteId}` : sql``;
  const ids = scope.personIds?.length
    ? sql`and p.id in (${sql.join(
        scope.personIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

  return sql`
    select e.person_id, p.site_id::text as site_id, ${day} as day, e.payload, e.occurred_at, e.id
    from people p
    cross join lateral (
      select e.* from person_events e
      where e.company_id = p.company_id
        and e.person_id = p.id
        and e.occurred_at >= ${lo} and e.occurred_at < ${hi}
        and e.type = ${type}
    ) e
    where p.company_id = ${companyId}
      ${site}
      ${ids}
      ${dayFilter}
      and ${day} between ${range.from} and ${range.to}`;
};

/**
 * The incidencias in force: per (person, day, kind) the event with the highest
 * payload.rev, dropped when it is voided. Columns: person_id, site_id, day,
 * kind, minutes, justified.
 */
const effectiveIncidencias = (
  companyId: string,
  range: DayRange,
  scope: Scope,
): SQL => sql`
  select person_id, site_id, day, kind, minutes, justified
  from (
    select distinct on (person_id, day, kind)
      person_id, site_id, day, kind, minutes, justified, voided
    from (
      select person_id, site_id, day,
        payload ->> 'kind' as kind,
        case when payload ->> 'minutes' ~ '^[0-9]{1,5}$' then (payload ->> 'minutes')::int else 0 end as minutes,
        coalesce(payload -> 'justified' = 'true'::jsonb, false) as justified,
        coalesce(payload -> 'voided' = 'true'::jsonb, false) as voided,
        case when payload ->> 'rev' ~ '^[0-9]{1,6}$' then (payload ->> 'rev')::int else 0 end as rev,
        occurred_at, id
      from (${scopedEvents(companyId, "incidencia", range, scope)}) scoped
    ) typed
    where char_length(kind) between 1 and 32
    order by person_id, day, kind, rev desc, occurred_at desc, id desc
  ) latest
  where not voided`;

const groupKey = (by: AggregateGroup) => {
  switch (by) {
    case "person":
      return sql.raw("person_id::text");
    case "site":
      return sql.raw("site_id");
    case "month":
      return sql.raw("substr(day, 1, 7)");
  }
};

/**
 * Incidencias per person and kind in a range, as the statement the period
 * close inserts from (src/lib/pay-periods). Columns: person_id, kind, count,
 * justified, minutes.
 */
export const incidenciasByPersonSql = (
  companyId: string,
  range: DayRange,
): SQL => sql`
  select person_id, kind,
    count(*)::int as count,
    (count(*) filter (where justified))::int as justified,
    sum(minutes)::int as minutes
  from (${effectiveIncidencias(companyId, range, {})}) eff
  group by person_id, kind`;

/** The statement incidenciasBy runs (exported for the EXPLAIN checks). */
export const incidenciasBySql = (
  companyId: string,
  range: DayRange,
  options: Pick<AggregateOptions, "by" | "siteId" | "personIds">,
): SQL => sql`
  select ${groupKey(options.by)} as key, kind,
    count(*)::int as count,
    (count(*) filter (where justified))::int as justified,
    coalesce(sum(minutes), 0)::int as minutes
  from (${effectiveIncidencias(companyId, range, options)}) eff
  group by 1, 2
  order by 1 nulls last, 2`;

export type IncidenciasAggregate = {
  /** personId, siteId (null for people without a site) or 'YYYY-MM'. */
  key: string | null;
  kind: string;
  /** Days with this incidencia. */
  count: number;
  /** Of those, justified. */
  justified: number;
  /** Minutes added up (retardo, salida anticipada). */
  minutes: number;
};

/**
 * Incidencias in a range, grouped by person, site or month and by kind, for
 * the today view, reports and the HR MCP tools. Empty for an id outside the
 * company.
 */
export const incidenciasBy = async (
  companyId: string,
  range: DayRange,
  options: AggregateOptions,
): Promise<IncidenciasAggregate[]> => {
  windowOf(range);

  if (isEmptyScope(options)) {
    return [];
  }

  const result = await (options.executor ?? tdb(companyId)).execute(
    incidenciasBySql(companyId, range, options),
  );

  return result.rows as IncidenciasAggregate[];
};

export type AbsenteeismAggregate = {
  /** personId, siteId (null for people without a site) or 'YYYY-MM'. */
  key: string | null;
  /** Days with an attendance row. */
  presentDays: number;
  /** Days with a falta in force. */
  absentDays: number;
  /** Of those, justified. */
  justifiedAbsentDays: number;
  /** absentDays / (presentDays + absentDays); null when both are 0. */
  rate: number | null;
};

/**
 * Absenteeism in a range, grouped by person, site or month: faltas over the
 * days that had either an attendance row or a falta. The days a person was
 * expected to work come from these two rows, not from a schedule.
 */
export const absenteeismBy = async (
  companyId: string,
  range: DayRange,
  options: AggregateOptions,
): Promise<AbsenteeismAggregate[]> => {
  windowOf(range);

  if (isEmptyScope(options)) {
    return [];
  }

  const result = await (options.executor ?? tdb(companyId)).execute(
    absenteeismBySql(companyId, range, options),
  );

  return result.rows as AbsenteeismAggregate[];
};

/** The statement absenteeismBy runs (exported for the EXPLAIN checks). */
export const absenteeismBySql = (
  companyId: string,
  range: DayRange,
  options: Pick<AggregateOptions, "by" | "siteId" | "personIds">,
): SQL => {
  const key = groupKey(options.by);

  return sql`
    with days as (
      select person_id, site_id, day, 1 as present, 0 as absent, 0 as justified
      from (${scopedEvents(companyId, "attendance", range, options)}) att
      union all
      select person_id, site_id, day, 0, 1, case when justified then 1 else 0 end
      from (${effectiveIncidencias(companyId, range, options)}) eff
      where kind = 'falta'
    )
    select ${key} as key,
      sum(present)::int as "presentDays",
      sum(absent)::int as "absentDays",
      sum(justified)::int as "justifiedAbsentDays",
      case when sum(present) + sum(absent) = 0 then null
           else round(sum(absent)::numeric / (sum(present) + sum(absent)), 4)::float8 end as rate
    from days
    group by 1
    order by 1 nulls last`;
};

/** The statement unjustifiedFaltaDays runs (exported for the EXPLAIN checks). */
export const unjustifiedFaltaDaysSql = (
  companyId: string,
  range: DayRange,
  options: Pick<AggregateOptions, "siteId" | "personIds">,
): SQL => sql`
  select person_id::text as "personId", day
  from (${effectiveIncidencias(companyId, range, options)}) eff
  where kind = 'falta' and not justified
  order by 1, 2`;

/**
 * The days each person has a falta in force that is not justified (nor
 * voided), for the LFT absence alerts (W2-19). Empty for an id outside the
 * company.
 */
export const unjustifiedFaltaDays = async (
  companyId: string,
  range: DayRange,
  options: Pick<AggregateOptions, "siteId" | "personIds" | "executor"> = {},
): Promise<Array<{ personId: string; day: string }>> => {
  windowOf(range);

  if (isEmptyScope(options)) {
    return [];
  }

  const result = await (options.executor ?? tdb(companyId)).execute(
    unjustifiedFaltaDaysSql(companyId, range, options),
  );

  return result.rows as Array<{ personId: string; day: string }>;
};
