import { and, asc, count, eq, gt, isNotNull, like, or, sql } from "drizzle-orm";

import { db, tdb, withTransaction, type DbExecutor } from "@/lib/db";
import {
  auditEvents,
  companies,
  employmentPeriods,
  people,
  personDocuments,
  personEvents,
  vacationRecords,
} from "@/lib/db/schema";

import {
  documentEvent,
  employmentAltaEvent,
  employmentBajaEvent,
  employmentChangeFromAudit,
  EMPLOYMENT_DIMENSIONS,
  vacationEnjoymentEvent,
  vacationVoidEvent,
} from "./events";
import { appendPersonEvents, type PersonEventInput } from "./index";

/**
 * Backfill of the person timeline (Workia 2.0 W2-13) from the tables that
 * already hold the facts: employment_periods (altas and bajas),
 * vacation_records (days taken and voids), person_documents (deliveries) and
 * the audit events of a person whose puesto, sucursal, área or jefe changed.
 * Audit events without a person are left out.
 *
 * Every event is built by the same function the live write uses, so its
 * dedupe key is the same and the backfill can run before, after or while the
 * app writes: a fact is stored once. Batches of BACKFILL_BATCH source rows,
 * each in its own transaction; a dry run rolls each batch back. Runs as the
 * database owner, across companies (a script, not a request).
 */

export const BACKFILL_BATCH = 500;

export const BACKFILL_KINDS = [
  "alta",
  "baja",
  "cambio",
  "vacation_enjoyment",
  "vacation_void",
  "document",
] as const;

export type BackfillKind = (typeof BACKFILL_KINDS)[number];

export type BackfillCount = {
  /** Facts in the source tables. */
  source: number;
  /** Events this run wrote (would write, on a dry run). */
  inserted: number;
  /** Events stored after the run. Equals `source` once applied. */
  stored: number;
};

export type TimelineBackfillReport = {
  applied: boolean;
  companies: number;
  counts: Record<BackfillKind, BackfillCount>;
  /** Every kind has as many events stored as facts in its source table. */
  matches: boolean;
};

const SOURCE = "backfill";

class DryRun extends Error {
  constructor(readonly inserted: number) {
    super("dry run");
  }
}

/** Writes one batch in its own transaction; a dry run rolls it back. */
const writeBatch = async (
  companyId: string,
  events: PersonEventInput[],
  apply: boolean,
) => {
  if (events.length === 0) return 0;

  try {
    return await withTransaction(async (tx) => {
      const inserted = await appendPersonEvents(companyId, events, tx);

      if (!apply) throw new DryRun(inserted);
      return inserted;
    }, companyId);
  } catch (error) {
    if (error instanceof DryRun) return error.inserted;
    throw error;
  }
};

/** Keyset pages of one table of one company, by id. */
async function* pages<T extends { id: string }>(
  read: (after: string | null) => Promise<T[]>,
) {
  let after: string | null = null;

  for (;;) {
    const rows = await read(after);

    if (rows.length === 0) return;
    yield rows;
    if (rows.length < BACKFILL_BATCH) return;
    after = rows[rows.length - 1].id;
  }
}

const storedCount = async (
  executor: DbExecutor,
  companyId: string,
  pattern: string,
  kind?: string,
) => {
  const [row] = await executor
    .select({ total: count() })
    .from(personEvents)
    .where(
      and(
        eq(personEvents.companyId, companyId),
        like(personEvents.dedupeKey, pattern),
        kind ? sql`${personEvents.payload} ->> 'kind' = ${kind}` : undefined,
      ),
    );

  return Number(row?.total ?? 0);
};

/** The dedupe key pattern of each kind, as events.ts builds it. */
const STORED_PATTERNS: Record<BackfillKind, [string, string?]> = {
  alta: ["employment:period:%:alta"],
  baja: ["employment:period:%:baja"],
  cambio: ["employment:audit:%", "cambio"],
  vacation_enjoyment: ["vacation:record:%:enjoyment"],
  vacation_void: ["vacation:record:%:void"],
  document: ["document:person_document:%:accepted"],
};

const backfillCompany = async (
  companyId: string,
  apply: boolean,
  counts: Record<BackfillKind, BackfillCount>,
  executor: DbExecutor,
) => {
  const add = (kind: BackfillKind, source: number, inserted: number) => {
    counts[kind].source += source;
    counts[kind].inserted += inserted;
  };

  for await (const periods of pages((after) =>
    executor
      .select()
      .from(employmentPeriods)
      .where(
        and(
          eq(employmentPeriods.companyId, companyId),
          after ? gt(employmentPeriods.id, after) : undefined,
        ),
      )
      .orderBy(asc(employmentPeriods.id))
      .limit(BACKFILL_BATCH),
  )) {
    const closed = periods.filter(
      (period) => period.fechaBaja !== null || period.bajaSinFecha,
    );

    add(
      "alta",
      periods.length,
      await writeBatch(
        companyId,
        periods.map((period) => employmentAltaEvent(period, SOURCE)),
        apply,
      ),
    );
    add(
      "baja",
      closed.length,
      await writeBatch(
        companyId,
        closed.map((period) => employmentBajaEvent(period, SOURCE)),
        apply,
      ),
    );
  }

  for await (const records of pages((after) =>
    executor
      .select()
      .from(vacationRecords)
      .where(
        and(
          eq(vacationRecords.companyId, companyId),
          after ? gt(vacationRecords.id, after) : undefined,
        ),
      )
      .orderBy(asc(vacationRecords.id))
      .limit(BACKFILL_BATCH),
  )) {
    const voided = records.flatMap((record) =>
      record.voidedAt ? [{ ...record, voidedAt: record.voidedAt }] : [],
    );

    add(
      "vacation_enjoyment",
      records.length,
      await writeBatch(
        companyId,
        records.map((record) => vacationEnjoymentEvent(record, SOURCE)),
        apply,
      ),
    );
    add(
      "vacation_void",
      voided.length,
      await writeBatch(
        companyId,
        voided.map((record) => vacationVoidEvent(record, SOURCE)),
        apply,
      ),
    );
  }

  for await (const documents of pages((after) =>
    executor
      .select()
      .from(personDocuments)
      .where(
        and(
          eq(personDocuments.companyId, companyId),
          after ? gt(personDocuments.id, after) : undefined,
        ),
      )
      .orderBy(asc(personDocuments.id))
      .limit(BACKFILL_BATCH),
  )) {
    add(
      "document",
      documents.length,
      await writeBatch(
        companyId,
        documents.map((document) => documentEvent(document, SOURCE)),
        apply,
      ),
    );
  }

  // Audit events of a person that still exists, that name a dimension change.
  const dimensionChanged = or(
    ...Object.keys(EMPLOYMENT_DIMENSIONS).map(
      (field) => sql`${auditEvents.payload} -> 'changes' ? ${field}`,
    ),
  );

  for await (const audits of pages((after) =>
    executor
      .select({
        id: auditEvents.id,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        action: auditEvents.action,
        source: auditEvents.source,
        occurredAt: auditEvents.occurredAt,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, companyId),
          eq(auditEvents.resourceType, "person"),
          isNotNull(auditEvents.payload),
          dimensionChanged,
          sql`exists (select 1 from ${people} where ${people.companyId} = ${auditEvents.companyId} and ${people.id}::text = ${auditEvents.resourceId})`,
          after ? gt(auditEvents.id, after) : undefined,
        ),
      )
      .orderBy(asc(auditEvents.id))
      .limit(BACKFILL_BATCH),
  )) {
    const events = audits.flatMap((audit) => {
      const event = employmentChangeFromAudit(audit);
      return event ? [event] : [];
    });

    add("cambio", events.length, await writeBatch(companyId, events, apply));
  }

  for (const kind of BACKFILL_KINDS) {
    const [pattern, payloadKind] = STORED_PATTERNS[kind];
    counts[kind].stored += await storedCount(
      executor,
      companyId,
      pattern,
      payloadKind,
    );
  }
};

/**
 * Backfills one company or every company. Dry run unless `apply`. Re-running
 * it after an apply inserts nothing.
 */
export const backfillPersonTimeline = async (
  options: { apply?: boolean; companyId?: string; executor?: DbExecutor } = {},
): Promise<TimelineBackfillReport> => {
  const apply = options.apply ?? false;
  const executor = options.executor ?? db;
  const counts = Object.fromEntries(
    BACKFILL_KINDS.map((kind) => [kind, { source: 0, inserted: 0, stored: 0 }]),
  ) as Record<BackfillKind, BackfillCount>;
  const companyIds = options.companyId
    ? [options.companyId]
    : (
        await executor
          .select({ id: companies.id })
          .from(companies)
          .orderBy(companies.id)
      ).map((company) => company.id);

  for (const companyId of companyIds) {
    // Reads see the company under row-level security too.
    await backfillCompany(
      companyId,
      apply,
      counts,
      options.executor ?? tdb(companyId),
    );
  }

  return {
    applied: apply,
    companies: companyIds.length,
    counts,
    matches: BACKFILL_KINDS.every(
      (kind) => counts[kind].stored === counts[kind].source,
    ),
  };
};
