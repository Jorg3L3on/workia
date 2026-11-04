import { and, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor, tdb } from "@/lib/db";
import { CompanyReferenceError } from "@/lib/db/errors";
import { clampPageSize, defineKeyset } from "@/lib/db/keyset";
import {
  companies,
  people,
  personEvents,
  type PersonEventType,
  personEventTypeEnum,
} from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

/**
 * The person timeline (Workia 2.0 P-01, docs/timeline.md). One append-only
 * table, person_events, keyed by (company_id, person_id). Callers write an
 * event in the same transaction as the change that caused it, by passing that
 * transaction as `executor`. Who did it goes to audit_events, not here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PERSON_EVENT_TYPES = personEventTypeEnum.enumValues;

/** Rows per INSERT statement: 9 columns, far under Postgres' parameter limit. */
export const APPEND_BATCH_SIZE = 500;

/** The most rows one read returns. */
export const MAX_TIMELINE_PAGE = 200;

export type PersonEventInput = {
  personId: string;
  type: PersonEventType;
  occurredAt: Date;
  /** Who produced the event: "app", "checador:<device>", "import", ... (1-64 chars). */
  source: string;
  /** Idempotency key, unique per company. Attendance must use attendanceDedupeKey. */
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
};

/** One attendance row per person per day: the key is the local date, unique per person. */
export const attendanceDedupeKey = (day: string) => {
  if (!DAY.test(day)) {
    throw new Error(`Invalid attendance day: ${day}`);
  }

  return `attendance:${day}`;
};

/** Any other type: the event's own id in the system that produced it. */
export const sourceDedupeKey = (
  type: Exclude<PersonEventType, "attendance">,
  source: string,
  sourceId: string,
) => `${type}:${source}:${sourceId}`;

const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23503" ||
    isForeignKeyViolation((error as { cause?: unknown }).cause));

/**
 * Inserts events of one company in batches. A row whose dedupe key is already
 * stored for that person is skipped, so re-running an ingestion writes nothing twice. Returns
 * how many rows were inserted. A person outside the company is refused by the
 * composite foreign key and surfaces as CompanyReferenceError("personId").
 */
export const appendPersonEvents = async (
  companyId: string,
  events: PersonEventInput[],
  executor: DbExecutor = tdb(companyId),
): Promise<number> => {
  let inserted = 0;

  for (let start = 0; start < events.length; start += APPEND_BATCH_SIZE) {
    const rows = events
      .slice(start, start + APPEND_BATCH_SIZE)
      .map((event) => ({
        companyId,
        personId: event.personId,
        type: event.type,
        occurredAt: event.occurredAt,
        source: event.source,
        dedupeKey: event.dedupeKey ?? null,
        payload: event.payload ?? {},
      }));

    const written = await executor
      .insert(personEvents)
      .values(rows)
      .onConflictDoNothing({
        target: [personEvents.personId, personEvents.dedupeKey],
        where: sql`${personEvents.dedupeKey} is not null`,
      })
      .returning({ id: personEvents.id })
      .catch((error: unknown) => {
        if (isForeignKeyViolation(error)) {
          throw new CompanyReferenceError(
            "personId",
            "Esa persona no existe en esta empresa.",
          );
        }

        throw error;
      });

    inserted += written.length;
  }

  return inserted;
};

export type TimelinePage = {
  events: Array<{
    id: string;
    type: PersonEventType;
    occurredAt: Date;
    source: string;
    payload: Record<string, unknown>;
  }>;
  /** Opaque cursor: pass back as `cursor` for the next (older) page; null on the last one. */
  next: string | null;
};

/** Newest first; `id` breaks ties. Matches person_events_person_time_idx. */
const personTimeline = defineKeyset([
  { column: personEvents.occurredAt, type: "timestamptz", direction: "desc" },
  { column: personEvents.id, type: "uuid", direction: "desc" },
]);

/**
 * One person's history, newest first, in keyset pages: one range scan of
 * person_events_person_time_idx that starts at the cursor. Empty for a person
 * outside the company.
 */
export const listPersonEvents = async (
  companyId: string,
  personId: string,
  options: {
    types?: PersonEventType[];
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<TimelinePage> => {
  if (!UUID.test(personId)) {
    return { events: [], next: null };
  }

  const limit = clampPageSize(options.limit, 50, MAX_TIMELINE_PAGE);
  const conditions: SQL[] = [eq(personEvents.personId, personId)];

  if (options.types?.length) {
    conditions.push(inArray(personEvents.type, options.types));
  }

  const after = personTimeline.after(options.cursor);
  if (after) conditions.push(after);

  const rows = await tdb(companyId)
    .select({
      id: personEvents.id,
      type: personEvents.type,
      occurredAt: personEvents.occurredAt,
      source: personEvents.source,
      payload: personEvents.payload,
      cursor: personTimeline.cursor,
    })
    .from(personEvents)
    .where(withTenant(personEvents, companyId, ...conditions))
    .orderBy(...personTimeline.orderBy)
    .limit(limit + 1);

  const page = personTimeline.page(rows, limit);

  return { events: page.items, next: page.next };
};

/**
 * How long each type is kept, in years from occurred_at; null keeps it while
 * the person row exists. Attendance and incidencias are labor records: five
 * years covers the LFT, IMSS and SAT conservation periods. HR confirms the
 * legal period before the job is scheduled (docs/timeline.md).
 */
export const RETENTION_YEARS: Record<PersonEventType, number | null> = {
  attendance: 5,
  incidencia: 5,
  vacation: null,
  receipt: null,
  document: null,
  employment: null,
  permiso: null,
};

/** People per DELETE statement of the retention job. */
export const RETENTION_PEOPLE_BATCH = 100;

const yearsBefore = (now: Date, years: number) => {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
};

/**
 * The retention job: deletes rows older than RETENTION_YEARS, one type and
 * `peopleBatch` people of one company per statement, so each DELETE is a range
 * scan of person_events_person_time_idx and no statement holds locks or WAL
 * for long. There is no separate index for it. Runs as the database owner
 * across every company (a script, not a request).
 */
export const deleteExpiredPersonEvents = async (
  options: {
    now?: Date;
    peopleBatch?: number;
    retention?: Record<PersonEventType, number | null>;
    executor?: DbExecutor;
  } = {},
): Promise<Record<PersonEventType, number>> => {
  const now = options.now ?? new Date();
  const peopleBatch = options.peopleBatch ?? RETENTION_PEOPLE_BATCH;
  const retention = options.retention ?? RETENTION_YEARS;
  const executor = options.executor ?? db;
  const deleted = Object.fromEntries(
    PERSON_EVENT_TYPES.map((type) => [type, 0]),
  ) as Record<PersonEventType, number>;
  const expiring = PERSON_EVENT_TYPES.filter(
    (type) => retention[type] !== null,
  );

  if (expiring.length === 0) {
    return deleted;
  }

  const companyRows = await executor
    .select({ id: companies.id })
    .from(companies)
    .orderBy(companies.id);

  for (const company of companyRows) {
    let after: string | null = null;

    for (;;) {
      const page: Array<{ id: string }> = await executor
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.companyId, company.id),
            after ? gt(people.id, after) : undefined,
          ),
        )
        .orderBy(people.id)
        .limit(peopleBatch);

      if (page.length === 0) {
        break;
      }

      const personIds = page.map((person) => person.id);

      for (const type of expiring) {
        const rows = await executor
          .delete(personEvents)
          .where(
            and(
              eq(personEvents.companyId, company.id),
              inArray(personEvents.personId, personIds),
              eq(personEvents.type, type),
              lt(
                personEvents.occurredAt,
                yearsBefore(now, retention[type] as number),
              ),
            ),
          )
          .returning({ id: personEvents.id });

        deleted[type] += rows.length;
      }

      after = personIds[personIds.length - 1];

      if (page.length < peopleBatch) {
        break;
      }
    }
  }

  return deleted;
};
