import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { type DbTransaction, withTransaction } from "@/lib/db";
import {
  attendanceBadges,
  attendanceBatches,
  attendanceUnmatched,
  people,
  personEvents,
} from "@/lib/db/schema";
import type { AttendanceBatchSource } from "@/lib/db/schema/attendance";
import { withTenant } from "@/lib/tenant/scope";
import { attendanceDedupeKey } from "@/lib/timeline";
import {
  readAttendance,
  writeAttendanceDays,
  type AttendanceDayInput,
  type Punch,
} from "@/lib/timeline/writers";

import { normalizeBadge } from "./csv-format";
import { localDay } from "./time";

/**
 * The ingestion core (Workia 2.0 W2-12, docs/asistencia.md). Every source
 * (CSV upload, device push, app check-in, a number HR assigns later) ends
 * here: punches are matched to people, grouped into one attendance row per
 * person per local day, and merged into person_events by W2-13's
 * writeAttendanceDays. A punch already stored (same second, same device) is
 * skipped, so ingesting the same export twice writes nothing.
 *
 * One company's ingestions run one at a time (a transaction-scoped advisory
 * lock), so two uploads of the same day never race on its row.
 */

/** Punches accepted per call: a day's export of a large site, far under the limits. */
export const MAX_PUNCHES_PER_INGEST = 20_000;

/** Unplaced punches stored per call; the rest are only counted. */
export const MAX_UNMATCHED_STORED = 1_000;

/** A punch more than this far in the future is a checador with a wrong clock. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export type IncomingPunch = {
  /** Line of the file or index of the request, from 1 (for the unmatched report). */
  line: number;
  raw: string[];
  /** The person's number on the checador; null when the caller already knows the person. */
  badge: string | null;
  personId?: string;
  at: Date;
  /** Null when the source does not say; then it follows the order of the day. */
  kind: "in" | "out" | null;
};

export type InvalidRow = { line: number; raw: string[]; error: string };

export type IngestSummary = {
  batchId: string | null;
  rows: number;
  punchesAdded: number;
  duplicates: number;
  unmatched: number;
  invalid: number;
  daysWritten: number;
};

type Target =
  | {
      kind: "batch";
      source: AttendanceBatchSource;
      deviceId: string;
      siteId: string | null;
      fileName?: string | null;
      createdBy?: string | null;
    }
  | { kind: "app"; siteId: string };

const lockCompany = (tx: DbTransaction, companyId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`attendance:${companyId}`}, 0))`,
  );

/** The people behind a set of numbers (live people only), with their site. */
const resolveBadges = async (
  tx: DbTransaction,
  companyId: string,
  badges: string[],
) => {
  const found = new Map<string, { personId: string; siteId: string | null }>();

  for (let start = 0; start < badges.length; start += 1000) {
    const slice = badges.slice(start, start + 1000);
    const rows = await tx
      .select({
        badge: attendanceBadges.badge,
        personId: attendanceBadges.personId,
        siteId: people.siteId,
      })
      .from(attendanceBadges)
      .innerJoin(
        people,
        and(
          eq(people.companyId, attendanceBadges.companyId),
          eq(people.id, attendanceBadges.personId),
        ),
      )
      .where(
        withTenant(
          attendanceBadges,
          companyId,
          inArray(attendanceBadges.badge, slice),
          isNull(people.deletedAt),
        ),
      );

    for (const row of rows) {
      found.set(row.badge, { personId: row.personId, siteId: row.siteId });
    }
  }

  return found;
};

const personSites = async (
  tx: DbTransaction,
  companyId: string,
  personIds: string[],
) => {
  const sites = new Map<string, string | null>();

  if (personIds.length === 0) return sites;

  const rows = await tx
    .select({ id: people.id, siteId: people.siteId })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        inArray(people.id, personIds),
        isNull(people.deletedAt),
      ),
    );

  for (const row of rows) sites.set(row.id, row.siteId);

  return sites;
};

/** The stored punches of the days about to be written, to count duplicates and order kinds. */
const storedPunches = async (
  tx: DbTransaction,
  companyId: string,
  days: Array<{ personId: string; day: string }>,
) => {
  const stored = new Map<string, Punch[]>();

  for (let start = 0; start < days.length; start += 500) {
    const slice = days.slice(start, start + 500);
    const rows = await tx
      .select({
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
          inArray(personEvents.personId, [
            ...new Set(slice.map((day) => day.personId)),
          ]),
          inArray(personEvents.dedupeKey, [
            ...new Set(slice.map((day) => attendanceDedupeKey(day.day))),
          ]),
        ),
      );

    for (const row of rows) {
      stored.set(
        `${row.personId}|${row.dedupeKey}`,
        readAttendance(row.payload).punches,
      );
    }
  }

  return stored;
};

const toSecond = (at: Date) => `${at.toISOString().slice(0, 19)}Z`;

/**
 * Ingests punches of one company in one transaction. A punch whose number is
 * nobody's, or a row that did not read, goes to attendance_unmatched with its
 * raw cells. Returns what it did; the batch row keeps the same counts.
 */
export const ingestPunches = async (
  companyId: string,
  target: Target,
  punches: IncomingPunch[],
  invalidRows: InvalidRow[] = [],
  options: {
    now?: Date;
    rows?: number;
    tx?: DbTransaction;
    /** False when re-placing punches already reported (no new batch, no report rows). */
    recordBatch?: boolean;
  } = {},
): Promise<IngestSummary> => {
  if (punches.length > MAX_PUNCHES_PER_INGEST) {
    throw new Error(
      `At most ${MAX_PUNCHES_PER_INGEST} punches per ingestion (got ${punches.length}).`,
    );
  }

  const now = options.now ?? new Date();
  const deviceId = target.kind === "batch" ? target.deviceId : "app";
  const source = target.kind === "batch" ? `checador:${target.deviceId}` : "app";

  const run = async (tx: DbTransaction): Promise<IngestSummary> => {
    await lockCompany(tx, companyId);

    // Rows that are not punches: a wrong clock is a row HR must see.
    const invalid: InvalidRow[] = [...invalidRows];
    const valid: IncomingPunch[] = [];

    for (const punch of punches) {
      if (punch.at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
        invalid.push({
          line: punch.line,
          raw: punch.raw,
          error: "La checada es de una fecha futura: revisa el reloj del checador.",
        });
      } else {
        valid.push(punch);
      }
    }

    const badges = [
      ...new Set(
        valid
          .filter((punch) => !punch.personId && punch.badge)
          .map((punch) => normalizeBadge(punch.badge as string)),
      ),
    ];
    const byBadge = await resolveBadges(tx, companyId, badges);
    const knownIds = [
      ...new Set(
        valid.flatMap((punch) => (punch.personId ? [punch.personId] : [])),
      ),
    ];
    const knownSites = await personSites(tx, companyId, knownIds);

    type Placed = IncomingPunch & { personId: string; personSiteId: string | null };
    const placed: Placed[] = [];
    const unknown: IncomingPunch[] = [];

    for (const punch of valid) {
      if (punch.personId) {
        if (knownSites.has(punch.personId)) {
          placed.push({
            ...punch,
            personId: punch.personId,
            personSiteId: knownSites.get(punch.personId) ?? null,
          });
        } else {
          unknown.push(punch);
        }
        continue;
      }

      const person = punch.badge ? byBadge.get(normalizeBadge(punch.badge)) : undefined;

      if (person) {
        placed.push({ ...punch, personId: person.personId, personSiteId: person.siteId });
      } else {
        unknown.push(punch);
      }
    }

    // One attendance row per person per local day.
    const groups = new Map<
      string,
      { personId: string; day: string; siteId: string | null; punches: Placed[] }
    >();

    for (const punch of placed) {
      const day = localDay(punch.at);
      const key = `${punch.personId}|${attendanceDedupeKey(day)}`;
      const group = groups.get(key);
      const siteId = target.siteId ?? punch.personSiteId;

      if (group) {
        group.punches.push(punch);
      } else {
        groups.set(key, { personId: punch.personId, day, siteId, punches: [punch] });
      }
    }

    const stored = await storedPunches(tx, companyId, [...groups.values()]);
    const days: AttendanceDayInput[] = [];
    let punchesAdded = 0;
    let duplicates = 0;

    for (const [key, group] of groups) {
      const before = stored.get(key) ?? [];
      const seen = new Set(before.map((punch) => `${punch.at}|${punch.device_id ?? ""}`));
      const fresh: Array<{ at: string; kind: "in" | "out" | null }> = [];

      for (const punch of group.punches.sort((a, b) => a.at.getTime() - b.at.getTime())) {
        const at = toSecond(punch.at);
        const id = `${at}|${deviceId}`;

        if (seen.has(id)) {
          duplicates += 1;
          continue;
        }

        seen.add(id);
        fresh.push({ at, kind: punch.kind });
      }

      if (fresh.length === 0) continue;

      // A punch without entrada/salida takes the turn of its place in the
      // day: first an entrada, then a salida, and so on.
      const timeline = [
        ...before.map((punch) => ({ at: punch.at, stored: true as const })),
        ...fresh.map((punch) => ({ at: punch.at, stored: false as const })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      const position = new Map<string, number>();

      timeline.forEach((entry, index) => {
        if (!entry.stored) position.set(entry.at, index);
      });

      punchesAdded += fresh.length;
      days.push({
        personId: group.personId,
        day: group.day,
        siteId: group.siteId,
        source,
        punches: fresh.map((punch) => ({
          at: punch.at,
          kind: punch.kind ?? ((position.get(punch.at) ?? 0) % 2 === 0 ? "in" : "out"),
          device_id: deviceId,
        })),
      });
    }

    const written = days.length > 0 ? await writeAttendanceDays(companyId, days, tx) : null;

    let batchId: string | null = null;
    const counts = {
      rows: options.rows ?? punches.length + invalidRows.length,
      punchesAdded,
      duplicates,
      unmatched: unknown.length,
      invalid: invalid.length,
    };

    if (target.kind === "batch" && options.recordBatch !== false) {
      if (target.source === "device") {
        const [batch] = await tx
          .insert(attendanceBatches)
          .values({
            companyId,
            deviceId: target.deviceId,
            source: "device",
            pushDay: localDay(now),
            ...counts,
          })
          .onConflictDoUpdate({
            target: [attendanceBatches.deviceId, attendanceBatches.pushDay],
            targetWhere: sql`${attendanceBatches.source} = 'device'`,
            set: {
              rows: sql`${attendanceBatches.rows} + ${counts.rows}`,
              punchesAdded: sql`${attendanceBatches.punchesAdded} + ${counts.punchesAdded}`,
              duplicates: sql`${attendanceBatches.duplicates} + ${counts.duplicates}`,
              unmatched: sql`${attendanceBatches.unmatched} + ${counts.unmatched}`,
              invalid: sql`${attendanceBatches.invalid} + ${counts.invalid}`,
              updatedAt: now,
            },
          })
          .returning({ id: attendanceBatches.id });

        batchId = batch.id;
      } else {
        const [batch] = await tx
          .insert(attendanceBatches)
          .values({
            companyId,
            deviceId: target.deviceId,
            source: "csv",
            fileName: target.fileName?.slice(0, 200) ?? null,
            createdBy: target.createdBy ?? null,
            ...counts,
          })
          .returning({ id: attendanceBatches.id });

        batchId = batch.id;
      }

      const report = [
        ...unknown.map((punch) => ({
          companyId,
          batchId: batchId as string,
          deviceId: target.deviceId,
          reason: "unknown_badge" as const,
          line: punch.line,
          badge: punch.badge ? normalizeBadge(punch.badge).slice(0, 40) : null,
          punchedAt: punch.at,
          kind: punch.kind,
          raw: punch.raw,
        })),
        ...invalid.map((row) => ({
          companyId,
          batchId: batchId as string,
          deviceId: target.deviceId,
          reason: "invalid_row" as const,
          line: row.line,
          badge: null,
          punchedAt: null,
          kind: null,
          raw: [...row.raw, `⚠ ${row.error}`],
        })),
      ].slice(0, MAX_UNMATCHED_STORED);

      for (let start = 0; start < report.length; start += 500) {
        await tx
          .insert(attendanceUnmatched)
          .values(report.slice(start, start + 500))
          .onConflictDoNothing();
      }
    }

    return {
      batchId,
      ...counts,
      daysWritten: written ? written.inserted + written.merged : 0,
    };
  };

  return options.tx ? run(options.tx) : withTransaction(run, companyId);
};
