import { eq, getTableName, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db, tdb } from "@/lib/db";
import { clampPageSize, defineKeyset, type KeysetPage } from "@/lib/db/keyset";
import { people, personEvents } from "@/lib/db/schema";
import { DISPLAY_TIME_ZONE } from "@/lib/format/date";
import { withTenant } from "@/lib/tenant/scope";

import { attendanceDedupeKey } from "./index";

/**
 * The today view (Workia 2.0 P-04, docs/keyset.md): the active people of one
 * scope with their attendance row and incidencias of one day. It starts from
 * the roster, not from the punches, so absent people are in it too.
 *
 * Indexes, and no new one: the roster comes from people_site_id_idx,
 * people_area_id_idx or people_manager_id_idx; each person's attendance is one
 * probe of person_events_dedupe_unique (person_id, 'attendance:<day>'); their
 * incidencias of the day are one short range of person_events_person_time_idx.
 */

export const MAX_TODAY_PAGE = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whose day it is: one site, one area, or a manager's direct reports (W2-07). */
export type TodayScope =
  { siteId: string } | { areaId: string } | { managerId: string };

export type TodayRow = {
  personId: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  /** The day's attendance payload (punches), or null when nobody punched. */
  attendance: Record<string, unknown> | null;
  /** The day's incidencias, oldest first. */
  incidencias: Array<{
    id: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }>;
};

/** By name, then id: the order the list shows. */
const roster = defineKeyset([
  { column: people.apellidoPaterno, type: "text" },
  { column: people.nombres, type: "text" },
  { column: people.id, type: "uuid" },
]);

/**
 * `"people"."id"` written out: Drizzle drops the table name of a column in a
 * one-table select, and inside the subqueries below a bare "id" would bind to
 * person_events.
 */
const outer = (column: AnyPgColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

const scopeCondition = (scope: TodayScope) => {
  if ("siteId" in scope) return eq(people.siteId, scope.siteId);
  if ("areaId" in scope) return eq(people.areaId, scope.areaId);
  return eq(people.managerId, scope.managerId);
};

const scopeId = (scope: TodayScope) =>
  "siteId" in scope
    ? scope.siteId
    : "areaId" in scope
      ? scope.areaId
      : scope.managerId;

type TodayOptions = { day: string; cursor?: string | null; limit?: number };

/**
 * The query of one page, not run: `limit + 1` rows. Exported so the plan test
 * and scripts/measure-person-timeline.ts EXPLAIN exactly what the app runs.
 */
export const todayPageQuery = (
  companyId: string,
  scope: TodayScope,
  options: TodayOptions,
  executor: typeof db = tdb(companyId),
) => {
  const limit = clampPageSize(options.limit, 100, MAX_TODAY_PAGE);
  const dedupeKey = attendanceDedupeKey(options.day);
  const dayStart = sql`(${options.day}::date::timestamp at time zone ${DISPLAY_TIME_ZONE})`;
  const dayEnd = sql`((${options.day}::date + 1)::timestamp at time zone ${DISPLAY_TIME_ZONE})`;

  return executor
    .select({
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      attendance: sql<Record<string, unknown> | null>`(
        select a.payload from ${personEvents} a
        where a.company_id = ${outer(people.companyId)}
          and a.person_id = ${outer(people.id)}
          and a.dedupe_key = ${dedupeKey}
      )`,
      incidencias: sql<TodayRow["incidencias"]>`coalesce((
        select json_agg(json_build_object(
          'id', i.id, 'occurredAt', i.occurred_at, 'payload', i.payload
        ) order by i.occurred_at, i.id)
        from ${personEvents} i
        where i.company_id = ${outer(people.companyId)}
          and i.person_id = ${outer(people.id)}
          and i.type = 'incidencia'
          and i.occurred_at >= ${dayStart}
          and i.occurred_at < ${dayEnd}
      ), '[]'::json)`,
      cursor: roster.cursor,
    })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        scopeCondition(scope),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
        roster.after(options.cursor),
      ),
    )
    .orderBy(...roster.orderBy)
    .limit(limit + 1);
};

/**
 * One keyset page of the today view. `day` is the local date (yyyy-mm-dd, in
 * America/Mexico_City, the same date the attendance dedupe key holds). One
 * query per page: the attendance and incidencias are correlated subqueries.
 */
export const listTodayPage = async (
  companyId: string,
  scope: TodayScope,
  options: TodayOptions,
): Promise<KeysetPage<TodayRow>> => {
  if (!DAY.test(options.day)) {
    throw new Error(`Invalid day: ${options.day}`);
  }

  if (!UUID.test(scopeId(scope))) {
    return { items: [], next: null };
  }

  const rows = await todayPageQuery(companyId, scope, options);

  return roster.page(rows, clampPageSize(options.limit, 100, MAX_TODAY_PAGE));
};
