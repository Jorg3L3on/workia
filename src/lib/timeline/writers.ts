import { eq, inArray, like } from "drizzle-orm";

import { withTransaction, type DbExecutor, type DbTransaction } from "@/lib/db";
import { personEvents } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  dayInstant,
  employmentChangeFromAudit,
  incidenciaEvent,
  type IncidenciaInput,
} from "./events";
import {
  APPEND_BATCH_SIZE,
  appendPersonEvents,
  attendanceDedupeKey,
  type PersonEventInput,
} from "./index";

/**
 * The batch writers of the jobs (Workia 2.0 W2-13): attendance from the
 * ingestion (W2-12) and incidencias from the engine (W2-14). person_events is
 * append-only for the app (no UPDATE), so a day that gets more punches is a
 * delete of its row and an insert of the merged one, in one transaction. A
 * day whose punches did not change is not written at all, so a re-run of the
 * same file costs one read per batch and no writes.
 */

export type Punch = {
  /** ISO instant of the punch. */
  at: string;
  kind: "in" | "out";
  /** The checador that read it, when the day has more than one. */
  device_id?: string;
};

/**
 * A punch as stored: [instant to the second, kind, device?]. Attendance is
 * nearly every row of the table, so the day's row keeps tuples and no
 * derived fields: about 160 bytes for a day with a site and two punches,
 * against about 270 as objects with first_in and last_out.
 */
type StoredPunch = [at: string, kind: "in" | "out", deviceId?: string];

export type AttendanceDayInput = {
  personId: string;
  /** Local date of the site, YYYY-MM-DD. */
  day: string;
  punches: Punch[];
  siteId?: string | null;
  /** "checador:<device>", "import", ... */
  source: string;
};

export type AttendanceWriteResult = {
  /** Days that had no row. */
  inserted: number;
  /** Days whose row was replaced by the merged punches. */
  merged: number;
  /** Days that already had every punch. */
  unchanged: number;
};

/** Two writers raced on the same rows; the job retries the batch. */
export class TimelineConflictError extends Error {
  constructor() {
    super("Another write changed the same timeline rows; retry the batch.");
    this.name = "TimelineConflictError";
  }
}

// The same instant from the same device is one punch: exports without an
// entrada/salida column infer the kind by order, so a re-upload can infer
// another kind for it. The kind stored first wins.
const punchKey = (punch: Punch) => `${punch.at}|${punch.device_id ?? ""}`;

/** An instant to the second, in UTC, without milliseconds. */
const toSecond = (value: string) => {
  const at = new Date(value);

  if (Number.isNaN(at.getTime())) {
    throw new Error(`Invalid punch instant: ${value}`);
  }

  return `${at.toISOString().slice(0, 19)}Z`;
};

const mergePunches = (...lists: Punch[][]) => {
  const byKey = new Map<string, Punch>();

  for (const punch of lists.flat()) {
    if (punch.kind !== "in" && punch.kind !== "out") {
      throw new Error(`Invalid punch kind: ${String(punch.kind)}`);
    }

    const normalized: Punch = {
      at: toSecond(punch.at),
      kind: punch.kind,
      ...(punch.device_id ? { device_id: punch.device_id } : {}),
    };
    const key = punchKey(normalized);

    if (!byKey.has(key)) byKey.set(key, normalized);
  }

  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
};

/** The day's payload: the site and the punches in time order. */
export const attendancePayload = (
  punches: Punch[],
  siteId: string | null | undefined,
) => ({
  ...(siteId ? { site_id: siteId } : {}),
  punches: punches.map((punch): StoredPunch =>
    punch.device_id
      ? [punch.at, punch.kind, punch.device_id]
      : [punch.at, punch.kind],
  ),
});

/**
 * Reads a stored attendance payload: its site, its punches, the first entry
 * and the last exit (derived, not stored).
 */
export const readAttendance = (payload: Record<string, unknown>) => {
  const stored = Array.isArray(payload.punches)
    ? (payload.punches as StoredPunch[])
    : [];
  const punches: Punch[] = stored.map(([at, kind, deviceId]) => ({
    at,
    kind,
    ...(deviceId ? { device_id: deviceId } : {}),
  }));

  return {
    siteId: (payload.site_id as string | undefined) ?? null,
    punches,
    firstIn: punches.find((punch) => punch.kind === "in")?.at ?? null,
    lastOut: punches.findLast((punch) => punch.kind === "out")?.at ?? null,
  };
};

const attendanceRow = (
  day: AttendanceDayInput,
  punches: Punch[],
  siteId: string | null | undefined,
): PersonEventInput => ({
  personId: day.personId,
  type: "attendance",
  occurredAt: punches[0] ? new Date(punches[0].at) : dayInstant(day.day),
  source: day.source,
  dedupeKey: attendanceDedupeKey(day.day),
  payload: attendancePayload(punches, siteId),
});

const writeAttendanceBatch = async (
  tx: DbTransaction,
  companyId: string,
  days: AttendanceDayInput[],
  result: AttendanceWriteResult,
) => {
  const keys = [...new Set(days.map((day) => attendanceDedupeKey(day.day)))];
  const personIds = [...new Set(days.map((day) => day.personId))];
  const existing = await tx
    .select({
      id: personEvents.id,
      personId: personEvents.personId,
      dedupeKey: personEvents.dedupeKey,
      payload: personEvents.payload,
    })
    .from(personEvents)
    .where(
      withTenant(
        personEvents,
        companyId,
        eq(personEvents.type, "attendance"),
        inArray(personEvents.personId, personIds),
        inArray(personEvents.dedupeKey, keys),
      ),
    );
  // No row lock: SELECT ... FOR UPDATE needs the UPDATE privilege the app
  // role does not have. A concurrent writer is caught below instead: its
  // delete or its insert leaves this one short, and the batch rolls back.
  const stored = new Map(
    existing.map((row) => [`${row.personId}|${row.dedupeKey}`, row]),
  );
  const replace: string[] = [];
  const rows: PersonEventInput[] = [];

  for (const day of days) {
    const current = stored.get(
      `${day.personId}|${attendanceDedupeKey(day.day)}`,
    );

    if (!current) {
      rows.push(attendanceRow(day, mergePunches(day.punches), day.siteId));
      result.inserted += 1;
      continue;
    }

    const today = readAttendance(current.payload);
    const after = mergePunches(today.punches, day.punches);
    const siteId = today.siteId ?? day.siteId ?? null;

    if (after.length === today.punches.length && siteId === today.siteId) {
      result.unchanged += 1;
      continue;
    }

    replace.push(current.id);
    rows.push(attendanceRow(day, after, siteId));
    result.merged += 1;
  }

  if (replace.length > 0) {
    const deleted = await tx
      .delete(personEvents)
      .where(
        withTenant(personEvents, companyId, inArray(personEvents.id, replace)),
      )
      .returning({ id: personEvents.id });

    if (deleted.length !== replace.length) {
      throw new TimelineConflictError();
    }
  }

  if (rows.length > 0) {
    const written = await appendPersonEvents(companyId, rows, tx);

    if (written !== rows.length) {
      throw new TimelineConflictError();
    }
  }
};

/**
 * Writes attendance days of one company: one row per person per day, its
 * punches merged with what is already stored. In its own transaction unless
 * the caller passes one, `APPEND_BATCH_SIZE` days per statement.
 */
export const writeAttendanceDays = async (
  companyId: string,
  days: AttendanceDayInput[],
  executor?: DbTransaction,
): Promise<AttendanceWriteResult> => {
  // The same person and day twice in one call is one day.
  const grouped = new Map<string, AttendanceDayInput>();

  for (const day of days) {
    const key = `${day.personId}|${attendanceDedupeKey(day.day)}`;
    const seen = grouped.get(key);
    grouped.set(
      key,
      seen
        ? {
            ...seen,
            siteId: seen.siteId ?? day.siteId,
            punches: [...seen.punches, ...day.punches],
          }
        : day,
    );
  }

  const unique = [...grouped.values()];
  const run = async (tx: DbTransaction) => {
    const result: AttendanceWriteResult = {
      inserted: 0,
      merged: 0,
      unchanged: 0,
    };

    for (let start = 0; start < unique.length; start += APPEND_BATCH_SIZE) {
      await writeAttendanceBatch(
        tx,
        companyId,
        unique.slice(start, start + APPEND_BATCH_SIZE),
        result,
      );
    }

    return result;
  };

  return executor ? run(executor) : withTransaction(run, companyId);
};

export type IncidenciasWriteResult = {
  inserted: number;
  deleted: number;
  unchanged: number;
};

/** JSON with object keys sorted: jsonb does not keep the order they were written in. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value ?? null);

const sameJson = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * The engine's output for one open pay period and these people: their
 * incidencias of the period become exactly `incidencias`. Rows that did not
 * change stay; changed or gone ones are deleted and the new ones inserted,
 * in one transaction. A closed period is frozen by P-02's snapshot, so the
 * engine does not call this for it.
 */
export const replacePeriodIncidencias = async (
  companyId: string,
  input: {
    period: string;
    personIds: string[];
    incidencias: Omit<IncidenciaInput, "period">[];
  },
  executor?: DbTransaction,
): Promise<IncidenciasWriteResult> => {
  if (!/^[0-9A-Za-z-]{1,32}$/.test(input.period)) {
    throw new Error(`Invalid pay period: ${input.period}`);
  }

  const people = new Set(input.personIds);
  const wanted = input.incidencias.map((item) =>
    incidenciaEvent({ ...item, period: input.period }),
  );

  for (const event of wanted) {
    if (!people.has(event.personId)) {
      throw new Error("Every incidencia must belong to one of personIds.");
    }
  }

  const run = async (tx: DbTransaction) => {
    const result: IncidenciasWriteResult = {
      inserted: 0,
      deleted: 0,
      unchanged: 0,
    };
    const ids = [...people];

    for (let start = 0; start < ids.length; start += APPEND_BATCH_SIZE) {
      const batch = ids.slice(start, start + APPEND_BATCH_SIZE);
      const inBatch = new Set(batch);
      const stored = await tx
        .select({
          id: personEvents.id,
          personId: personEvents.personId,
          dedupeKey: personEvents.dedupeKey,
          payload: personEvents.payload,
        })
        .from(personEvents)
        .where(
          withTenant(
            personEvents,
            companyId,
            eq(personEvents.type, "incidencia"),
            inArray(personEvents.personId, batch),
            like(personEvents.dedupeKey, `incidencia:${input.period}:%`),
          ),
        );
      const byKey = new Map(
        stored.map((row) => [`${row.personId}|${row.dedupeKey}`, row]),
      );
      const keep = new Set<string>();
      const rows: PersonEventInput[] = [];

      for (const event of wanted) {
        if (!inBatch.has(event.personId)) continue;

        const key = `${event.personId}|${event.dedupeKey}`;
        const current = byKey.get(key);

        if (current && sameJson(current.payload, event.payload)) {
          keep.add(current.id);
          result.unchanged += 1;
          continue;
        }

        rows.push(event);
      }

      const gone = stored
        .filter((row) => !keep.has(row.id))
        .map((row) => row.id);

      if (gone.length > 0) {
        const deleted = await tx
          .delete(personEvents)
          .where(
            withTenant(personEvents, companyId, inArray(personEvents.id, gone)),
          )
          .returning({ id: personEvents.id });
        result.deleted += deleted.length;

        if (deleted.length !== gone.length) {
          throw new TimelineConflictError();
        }
      }

      const written = await appendPersonEvents(companyId, rows, tx);
      result.inserted += written;

      // Another run of the engine stored the same keys meanwhile.
      if (written !== rows.length) {
        throw new TimelineConflictError();
      }
    }

    return result;
  };

  return executor ? run(executor) : withTransaction(run, companyId);
};

/**
 * The «cambio» events of audit events just written (puesto, sucursal, área
 * or jefe of a person changed), in the caller's transaction. Other audit
 * events write nothing. Returns how many events were written.
 */
export const appendEmploymentChanges = async (
  companyId: string,
  audits: Array<Parameters<typeof employmentChangeFromAudit>[0] | undefined>,
  executor: DbExecutor,
) => {
  const events = audits.flatMap((audit) => {
    const event = audit ? employmentChangeFromAudit(audit) : null;
    return event ? [event] : [];
  });

  return events.length > 0
    ? appendPersonEvents(companyId, events, executor)
    : 0;
};
