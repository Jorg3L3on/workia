import { and, asc, eq, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import {
  incidenciasPeriodSnapshot,
  type PayPeriod,
  payPeriods,
} from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";
import { incidenciasByPersonSql } from "@/lib/timeline/aggregates";

import { MAX_REOPEN_REASON, PayPeriodError, quincenaRange } from "./quincena";

export {
  MAX_REOPEN_REASON,
  PayPeriodError,
  quincenaOf,
  quincenaRange,
} from "./quincena";

/**
 * Pay periods and the incidencias snapshot (Workia 2.0 P-02,
 * docs/aggregates.md). Every company pays quincenal. Closing a period freezes
 * its incidencias in incidencias_period_snapshot in the same transaction as
 * the close, so both commit or neither does. Reopening deletes the snapshot
 * in the transaction that reopens; the next close writes it again. Each close
 * and reopen leaves an audit event. Pre-nómina reads readPeriodSnapshot.
 */

export type PayPeriodView = Pick<
  PayPeriod,
  "id" | "period" | "startsOn" | "endsOn" | "status" | "closedAt" | "revision"
>;

const periodColumns = {
  id: payPeriods.id,
  period: payPeriods.period,
  startsOn: payPeriods.startsOn,
  endsOn: payPeriods.endsOn,
  status: payPeriods.status,
  closedAt: payPeriods.closedAt,
  revision: payPeriods.revision,
};

/** The period's row, or null while nobody has closed it (it is open). */
export const getPayPeriod = async (
  companyId: string,
  period: string,
): Promise<PayPeriodView | null> => {
  quincenaRange(period);
  const [row] = await tdb(companyId)
    .select(periodColumns)
    .from(payPeriods)
    .where(withTenant(payPeriods, companyId, eq(payPeriods.period, period)))
    .limit(1);

  return row ?? null;
};

export type ClosePayPeriodResult = {
  period: PayPeriodView;
  /** Snapshot rows written: one per person and incidencia kind. */
  snapshotRows: number;
};

/**
 * Closes a quincena: freezes its incidencias (incidenciasByPersonSql over
 * person_events) into incidencias_period_snapshot, marks the period closed
 * and records an audit event, all in one transaction. The period row is
 * locked first, so two closes of the same period cannot both write. A period
 * already closed is refused; reopen it first.
 */
export const closePayPeriod = async (
  companyId: string,
  period: string,
  options: { actorUserId?: string | null } = {},
): Promise<ClosePayPeriodResult> => {
  const range = quincenaRange(period);

  return withTransaction(async (tx) => {
    await tx
      .insert(payPeriods)
      .values({
        companyId,
        period,
        startsOn: range.from,
        endsOn: range.to,
      })
      .onConflictDoNothing({
        target: [payPeriods.companyId, payPeriods.period],
      });

    const [current] = await tx
      .select(periodColumns)
      .from(payPeriods)
      .where(
        and(eq(payPeriods.companyId, companyId), eq(payPeriods.period, period)),
      )
      .for("update");

    if (current.status === "closed") {
      throw new PayPeriodError(
        "already_closed",
        `El periodo ${period} ya está cerrado. Reábrelo para volver a cerrarlo.`,
      );
    }

    const written = await tx.execute(sql`
      with inserted as (
        insert into incidencias_period_snapshot
          (company_id, pay_period_id, person_id, kind, count, justified, minutes)
        select ${companyId}::uuid, ${current.id}::uuid, person_id, kind, count, justified, minutes
        from (${incidenciasByPersonSql(companyId, range)}) agg
        returning 1
      )
      select count(*)::int as rows from inserted`);
    const snapshotRows = (written.rows[0] as { rows: number }).rows;

    const [closed] = await tx
      .update(payPeriods)
      .set({
        status: "closed",
        closedAt: sql`now()`,
        revision: sql`${payPeriods.revision} + 1`,
      })
      .where(
        and(eq(payPeriods.companyId, companyId), eq(payPeriods.id, current.id)),
      )
      .returning(periodColumns);

    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "pay_period",
        resourceId: closed.id,
        action: "close",
        payload: {
          summary: `Cierre del periodo ${period} (revisión ${closed.revision}): ${snapshotRows} filas de incidencias.`,
          changes: { status: { from: "open", to: "closed" } },
          after: { period, revision: closed.revision, snapshotRows },
        },
      },
      tx,
    );

    return { period: closed, snapshotRows };
  }, companyId);
};

/**
 * Reopens a closed quincena: deletes its snapshot, marks it open and records
 * an audit event with the reason, in one transaction. The next close writes a
 * new snapshot and a new revision.
 */
export const reopenPayPeriod = async (
  companyId: string,
  period: string,
  options: { reason: string; actorUserId?: string | null },
): Promise<{ period: PayPeriodView; deletedRows: number }> => {
  quincenaRange(period);
  const reason = options.reason.trim();

  if (reason.length === 0 || reason.length > MAX_REOPEN_REASON) {
    throw new PayPeriodError(
      "reason_required",
      `Escribe el motivo de la reapertura (máximo ${MAX_REOPEN_REASON} caracteres).`,
    );
  }

  return withTransaction(async (tx) => {
    const [current] = await tx
      .select(periodColumns)
      .from(payPeriods)
      .where(
        and(eq(payPeriods.companyId, companyId), eq(payPeriods.period, period)),
      )
      .for("update");

    if (!current || current.status !== "closed") {
      throw new PayPeriodError(
        "not_closed",
        `El periodo ${period} no está cerrado.`,
      );
    }

    const deleted = await tx
      .delete(incidenciasPeriodSnapshot)
      .where(
        and(
          eq(incidenciasPeriodSnapshot.companyId, companyId),
          eq(incidenciasPeriodSnapshot.payPeriodId, current.id),
        ),
      )
      .returning({ personId: incidenciasPeriodSnapshot.personId });

    const [reopened] = await tx
      .update(payPeriods)
      .set({ status: "open", closedAt: null })
      .where(
        and(eq(payPeriods.companyId, companyId), eq(payPeriods.id, current.id)),
      )
      .returning(periodColumns);

    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "pay_period",
        resourceId: reopened.id,
        action: "reopen",
        payload: {
          summary: `Reapertura del periodo ${period} (revisión ${current.revision}): ${reason}`,
          changes: { status: { from: "closed", to: "open" } },
          before: {
            period,
            revision: current.revision,
            snapshotRows: deleted.length,
          },
        },
      },
      tx,
    );

    return { period: reopened, deletedRows: deleted.length };
  }, companyId);
};

export type PeriodSnapshotRow = {
  personId: string;
  kind: string;
  count: number;
  justified: number;
  minutes: number;
};

/**
 * What pre-nómina reads: the frozen incidencias of a closed period, by person
 * and kind (one range scan of the snapshot's primary key). Null while the
 * period is open, so a caller never mistakes live numbers for closed ones.
 */
export const readPeriodSnapshot = async (
  companyId: string,
  period: string,
): Promise<{ period: PayPeriodView; rows: PeriodSnapshotRow[] } | null> => {
  const current = await getPayPeriod(companyId, period);

  if (!current || current.status !== "closed") {
    return null;
  }

  const rows = await tdb(companyId)
    .select({
      personId: incidenciasPeriodSnapshot.personId,
      kind: incidenciasPeriodSnapshot.kind,
      count: incidenciasPeriodSnapshot.count,
      justified: incidenciasPeriodSnapshot.justified,
      minutes: incidenciasPeriodSnapshot.minutes,
    })
    .from(incidenciasPeriodSnapshot)
    .where(
      withTenant(
        incidenciasPeriodSnapshot,
        companyId,
        eq(incidenciasPeriodSnapshot.payPeriodId, current.id),
      ),
    )
    .orderBy(
      asc(incidenciasPeriodSnapshot.personId),
      asc(incidenciasPeriodSnapshot.kind),
    );

  return { period: current, rows };
};
