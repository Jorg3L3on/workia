import {
  and,
  eq,
  getTableName,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db, tdb } from "@/lib/db";
import { clampPageSize, defineKeyset, type KeysetPage } from "@/lib/db/keyset";
import {
  attendanceBatches,
  attendanceDevices,
  people,
  personEvents,
} from "@/lib/db/schema";
import { DISPLAY_TIME_ZONE } from "@/lib/format/date";
import { teamCondition, type ManagerAccess } from "@/lib/managers/scope";
import { withTenant } from "@/lib/tenant/scope";

import { absenteeismBy, incidenciasBy } from "./aggregates";
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

/**
 * Whose day it is: one site, one area, or a manager's direct reports (P-04),
 * or a signed-in manager's live team (W2-07 scope, with indirect reports and
 * the teams they cover for), optionally narrowed to one site or area of it.
 */
export type TodayScope =
  | { siteId: string }
  | { areaId: string }
  | { managerId: string }
  | TeamTodayScope;

export type TeamTodayScope = {
  team: ManagerAccess;
  siteId?: string | null;
  areaId?: string | null;
};

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

const scopeCondition = (scope: TodayScope): SQL => {
  if ("team" in scope) {
    return and(
      teamCondition(scope.team),
      scope.siteId ? eq(people.siteId, scope.siteId) : undefined,
      scope.areaId ? eq(people.areaId, scope.areaId) : undefined,
    ) as SQL;
  }
  if ("siteId" in scope) return eq(people.siteId, scope.siteId);
  if ("areaId" in scope) return eq(people.areaId, scope.areaId);
  return eq(people.managerId, scope.managerId);
};

/** Every id the scope carries is a uuid; anything else is an empty day. */
const validScope = (companyId: string, scope: TodayScope) => {
  if ("team" in scope) {
    return (
      scope.team.companyId === companyId &&
      [scope.siteId, scope.areaId].every((id) => !id || UUID.test(id))
    );
  }

  return UUID.test(
    "siteId" in scope
      ? scope.siteId
      : "areaId" in scope
        ? scope.areaId
        : scope.managerId,
  );
};

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

  if (!validScope(companyId, scope)) {
    return { items: [], next: null };
  }

  const rows = await todayPageQuery(companyId, scope, options);

  return roster.page(rows, clampPageSize(options.limit, 100, MAX_TODAY_PAGE));
};

export type TodayCounts = {
  /** Active people in the scope. */
  roster: number;
  /** With an attendance row for the day. */
  present: number;
  /** With a falta in force for the day. */
  absent: number;
  /** With a retardo in force for the day. */
  late: number;
  /** With a salida anticipada in force for the day. */
  leftEarly: number;
};

/**
 * The counts above the today view (Workia 2.0 W2-15, for W2-17): the same
 * numbers every screen and the HR MCP tools read, from the P-02 aggregates
 * (absenteeismBy and incidenciasBy over the scope's active people for one
 * day), never from a counter. Two statements: the roster ids through the
 * scope's people index, then one aggregate pass over their day.
 */
export const todayCounts = async (
  companyId: string,
  scope: TodayScope,
  day: string,
): Promise<TodayCounts> => {
  const empty = { roster: 0, present: 0, absent: 0, late: 0, leftEarly: 0 };

  if (!DAY.test(day)) {
    throw new Error(`Invalid day: ${day}`);
  }

  if (!validScope(companyId, scope)) {
    return empty;
  }

  const ids = (
    await tdb(companyId)
      .select({ id: people.id })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          scopeCondition(scope),
          eq(people.status, "activa"),
          isNull(people.deletedAt),
        ),
      )
  ).map((row) => row.id);

  if (ids.length === 0) {
    return empty;
  }

  const range = { from: day, to: day };
  const [absenteeism, incidencias] = await Promise.all([
    absenteeismBy(companyId, range, { by: "month", personIds: ids }),
    incidenciasBy(companyId, range, { by: "month", personIds: ids }),
  ]);
  const kind = (name: string) =>
    incidencias.find((row) => row.kind === name)?.count ?? 0;

  return {
    roster: ids.length,
    present: absenteeism[0]?.presentDays ?? 0,
    absent: absenteeism[0]?.absentDays ?? 0,
    late: kind("retardo"),
    leftEarly: kind("salida_anticipada"),
  };
};

export type TodaySource = {
  /** person_events.source of the day's attendance rows: "checador:<device id>", "app", ... */
  source: string;
  /** The checador's name, for "checador:<device id>" sources of this company. */
  deviceName: string | null;
  /** People of the scope whose day came from it. */
  people: number;
  /** The latest punch it brought for the scope (ISO instant), or null. */
  lastPunchAt: string | null;
  /**
   * When it last brought punches today (ISO instant): the latest CSV upload
   * or device push of the checador (W2-12 attendance_batches); for app
   * check-ins, which land as they happen, the latest punch. Null when no
   * import of today is recorded (a late match by HR, older data).
   */
  importedAt: string | null;
};

export type TodayImports = {
  /** People whose last punch of the day is an entry: in the building now, as of the last import. */
  onShift: number;
  /** Newest punch first. */
  sources: TodaySource[];
};

const DEVICE_SOURCE =
  /^checador:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Where the day's attendance of a scope came from, and how fresh it is
 * (Workia 2.0 W2-17): per source, the people it covers, its latest punch and
 * when it was last imported today (W2-12 batches), which is how far the
 * screen is current. Also counts who is on shift (last
 * punch an entry). One statement: the roster through the scope's people
 * index, one probe of person_events_dedupe_unique per person, then a group by
 * source. It reads the stored tuples ([at, kind, device?], sorted by time),
 * so the last element is the last punch.
 */
export const todayImports = async (
  companyId: string,
  scope: TodayScope,
  day: string,
): Promise<TodayImports> => {
  if (!DAY.test(day)) {
    throw new Error(`Invalid day: ${day}`);
  }

  if (!validScope(companyId, scope)) {
    return { onShift: 0, sources: [] };
  }

  const last = sql`(case when jsonb_typeof(${personEvents.payload}->'punches') = 'array' then ${personEvents.payload}->'punches'->-1 end)`;
  const rows = await tdb(companyId)
    .select({
      source: personEvents.source,
      people: sql<number>`count(*)::int`,
      onShift: sql<number>`(count(*) filter (where ${last}->>1 = 'in'))::int`,
      lastPunchAt: sql<string | null>`max(${last}->>0)`,
    })
    .from(people)
    .innerJoin(
      personEvents,
      and(
        eq(personEvents.companyId, people.companyId),
        eq(personEvents.personId, people.id),
        eq(personEvents.dedupeKey, attendanceDedupeKey(day)),
      ),
    )
    .where(
      withTenant(
        people,
        companyId,
        scopeCondition(scope),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    )
    .groupBy(personEvents.source);

  // Today's imports of the checadores above: a few rows of
  // attendance_batches_company_created_idx (batches created since local
  // midnight), and the devices by primary key. A push batch is one row per
  // device and day whose updated_at moves with each push.
  const deviceIds = [
    ...new Set(
      rows.flatMap((row) => DEVICE_SOURCE.exec(row.source)?.[1] ?? []),
    ),
  ];
  const devices =
    deviceIds.length === 0
      ? []
      : await tdb(companyId)
          .select({
            id: attendanceDevices.id,
            name: attendanceDevices.name,
            importedAt: sql<string | null>`(
              select to_char(max(b.updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
              from ${attendanceBatches} b
              where b.company_id = ${outer(attendanceDevices.companyId)}
                and b.device_id = ${outer(attendanceDevices.id)}
                and b.created_at >= (${day}::date::timestamp at time zone ${DISPLAY_TIME_ZONE})
            )`,
          })
          .from(attendanceDevices)
          .where(
            withTenant(
              attendanceDevices,
              companyId,
              inArray(attendanceDevices.id, deviceIds),
            ),
          );
  const byDevice = new Map(devices.map((device) => [device.id, device]));

  return {
    onShift: rows.reduce((sum, row) => sum + row.onShift, 0),
    sources: rows
      .map(({ source, people: count, lastPunchAt }) => {
        const deviceId = DEVICE_SOURCE.exec(source)?.[1];
        const device = deviceId ? byDevice.get(deviceId.toLowerCase()) : null;

        return {
          source,
          deviceName: device?.name ?? null,
          people: count,
          lastPunchAt,
          importedAt: device
            ? device.importedAt
            : source === "app"
              ? lastPunchAt
              : null,
        };
      })
      .sort(
        (a, b) =>
          (b.lastPunchAt ?? "").localeCompare(a.lastPunchAt ?? "") ||
          a.source.localeCompare(b.source),
      ),
  };
};
