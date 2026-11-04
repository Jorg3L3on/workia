import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import {
  incidenciasPeriodSnapshot,
  type PayPeriod,
  payPeriods,
  people,
} from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";
import {
  incidenciasBy,
  incidenciasByPersonSql,
} from "@/lib/timeline/aggregates";

import {
  isQuincena,
  MAX_REOPEN_REASON,
  PayPeriodError,
  previousQuincena,
  quincenaLabel,
  quincenaOf,
  quincenaRange,
} from "./quincena";

export {
  isQuincena,
  MAX_REOPEN_REASON,
  PayPeriodError,
  previousQuincena,
  quincenaLabel,
  quincenaOf,
  quincenaRange,
} from "./quincena";
export { lockOpenPayPeriod } from "./lock";

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
          (company_id, pay_period_id, person_id, kind, count, justified, minutes,
           justified_minutes, justified_vacation, justified_permiso_con_goce,
           justified_permiso_sin_goce, justified_incapacidad)
        select ${companyId}::uuid, ${current.id}::uuid, person_id, kind, count, justified, minutes,
          justified_minutes, justified_vacation, justified_permiso_con_goce,
          justified_permiso_sin_goce, justified_incapacidad
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

// ------------------------------------------------------------------ W2-15

/** The oldest quincena the list walks back to. */
const FIRST_LISTED_PERIOD = "2000-01-Q1";

export const MAX_PERIODS_PAGE = 48;

export type PayPeriodListItem = {
  period: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closed";
  closedAt: Date | null;
  /** How many times it was closed; 0 while nobody has closed it. */
  revision: number;
  /** The quincena `today` falls in. */
  current: boolean;
};

const clampLimit = (limit: number | undefined, fallback: number, max: number) =>
  Math.min(
    Math.max(
      Number.isFinite(limit) ? Math.trunc(limit as number) : fallback,
      1,
    ),
    max,
  );

/**
 * The company's quincenas, newest first, from the one `today` falls in back
 * to 2000 (Workia 2.0 W2-15). The calendar is generated; the rows of
 * pay_periods (only quincenas someone closed or the engine wrote) are read by
 * their unique (company_id, period) key, so a page is one index lookup and no
 * OFFSET. `cursor` is the last period of the previous page; a cursor that is
 * not a quincena starts over.
 */
export const listPayPeriods = async (
  companyId: string,
  options: { today: string; cursor?: string | null; limit?: number },
): Promise<{ items: PayPeriodListItem[]; next: string | null }> => {
  const limit = clampLimit(options.limit, 12, MAX_PERIODS_PAGE);
  const current = quincenaOf(options.today);
  const start =
    options.cursor && isQuincena(options.cursor) && options.cursor <= current
      ? options.cursor > FIRST_LISTED_PERIOD
        ? previousQuincena(options.cursor)
        : null
      : current;
  const periods: string[] = [];

  for (
    let period = start;
    period && periods.length < limit;
    period = period > FIRST_LISTED_PERIOD ? previousQuincena(period) : null
  ) {
    periods.push(period);
  }

  if (periods.length === 0) {
    return { items: [], next: null };
  }

  const rows = await tdb(companyId)
    .select(periodColumns)
    .from(payPeriods)
    .where(
      withTenant(payPeriods, companyId, inArray(payPeriods.period, periods)),
    );
  const byPeriod = new Map(rows.map((row) => [row.period, row]));
  const last = periods[periods.length - 1];

  return {
    items: periods.map((period) => {
      const row = byPeriod.get(period);
      const range = quincenaRange(period);

      return {
        period,
        label: quincenaLabel(period),
        startsOn: range.from,
        endsOn: range.to,
        status: row?.status ?? "open",
        closedAt: row?.closedAt ?? null,
        revision: row?.revision ?? 0,
        current: period === current,
      };
    }),
    next: last > FIRST_LISTED_PERIOD ? last : null,
  };
};

export type IncidenciaTotals = {
  count: number;
  justified: number;
  minutes: number;
};

export type SnapshotDifference = {
  personId: string;
  kind: string;
  /** What the close froze; null when the close froze nothing for it. */
  snapshot: IncidenciaTotals | null;
  /** What person_events give now; null when nothing is in force. */
  live: IncidenciaTotals | null;
};

/**
 * Recomputes a closed period from person_events with the statement the close
 * inserted from and compares it with the frozen snapshot, row by row (W2-15
 * acceptance: the snapshot of a closed period matches a recomputation). Null
 * while the period is open. A difference means an incidencia was written for
 * the period after it closed; the snapshot stays as it was until a reopen.
 */
export const verifyPeriodSnapshot = async (
  companyId: string,
  period: string,
): Promise<{
  period: PayPeriodView;
  matches: boolean;
  differences: SnapshotDifference[];
} | null> => {
  const current = await getPayPeriod(companyId, period);

  if (!current || current.status !== "closed") {
    return null;
  }

  const range = quincenaRange(period);
  const result = await tdb(companyId).execute(sql`
    with snap as (
      select person_id, kind, count, justified, minutes, justified_minutes,
        justified_vacation, justified_permiso_con_goce,
        justified_permiso_sin_goce, justified_incapacidad
      from incidencias_period_snapshot
      where company_id = ${companyId} and pay_period_id = ${current.id}
    ),
    live as (${incidenciasByPersonSql(companyId, range)})
    select coalesce(s.person_id, l.person_id)::text as "personId",
      coalesce(s.kind, l.kind) as kind,
      s.count as s_count, s.justified as s_justified, s.minutes as s_minutes,
      l.count as l_count, l.justified as l_justified, l.minutes as l_minutes
    from snap s
    full join live l on l.person_id = s.person_id and l.kind = s.kind
    where (s.count, s.justified, s.minutes, s.justified_minutes,
        s.justified_vacation, s.justified_permiso_con_goce,
        s.justified_permiso_sin_goce, s.justified_incapacidad)
      is distinct from (l.count, l.justified, l.minutes, l.justified_minutes,
        l.justified_vacation, l.justified_permiso_con_goce,
        l.justified_permiso_sin_goce, l.justified_incapacidad)
    order by 1, 2`);

  type Row = {
    personId: string;
    kind: string;
    s_count: number | null;
    s_justified: number | null;
    s_minutes: number | null;
    l_count: number | null;
    l_justified: number | null;
    l_minutes: number | null;
  };

  const differences = (result.rows as Row[]).map((row) => ({
    personId: row.personId,
    kind: row.kind,
    snapshot:
      row.s_count === null
        ? null
        : {
            count: row.s_count,
            justified: row.s_justified ?? 0,
            minutes: row.s_minutes ?? 0,
          },
    live:
      row.l_count === null
        ? null
        : {
            count: row.l_count,
            justified: row.l_justified ?? 0,
            minutes: row.l_minutes ?? 0,
          },
  }));

  return { period: current, matches: differences.length === 0, differences };
};

export const MAX_PERIOD_PEOPLE_PAGE = 200;

export type PeriodPersonRow = {
  personId: string;
  name: string;
  /** By kind (falta, retardo, salida_anticipada, ...). */
  kinds: Record<string, IncidenciaTotals>;
};

export type PayPeriodDetail = {
  period: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closed";
  closedAt: Date | null;
  revision: number;
  /** snapshot: frozen at the close. live: aggregated now from person_events. */
  source: "snapshot" | "live";
  /** Every person of the period added up, by kind. */
  totals: Record<string, IncidenciaTotals>;
  /** People with at least one incidencia in the period. */
  personCount: number;
  people: PeriodPersonRow[];
  next: string | null;
};

const encodeCursor = (values: string[]) =>
  Buffer.from(JSON.stringify(values), "utf8").toString("base64url");

const decodeCursor = (cursor: string | null | undefined) => {
  if (!cursor || cursor.length > 1024) return null;

  try {
    const values: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    return Array.isArray(values) &&
      values.length === 3 &&
      values.every((value) => typeof value === "string")
      ? (values as [string, string, string])
      : null;
  } catch {
    return null;
  }
};

const compareTuple = (a: string[], b: string[]) => {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }

  return 0;
};

/**
 * One period for the HR screen and the MCP tool: its status, and its
 * incidencias by person. A closed period reads its snapshot (what pre-nómina
 * sends); an open one the live aggregate, which is what a close would freeze
 * now. Both are bounded by the people with incidencias in one quincena. The
 * people come in name order, `limit` at a time, after `cursor`.
 */
export const getPayPeriodDetail = async (
  companyId: string,
  period: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<PayPeriodDetail> => {
  const limit = clampLimit(options.limit, 100, MAX_PERIOD_PEOPLE_PAGE);
  const { sorted, ...header } = await loadPayPeriodIncidencias(
    companyId,
    period,
  );
  const after = decodeCursor(options.cursor);
  const rest = after
    ? sorted.filter((item) => compareTuple(item.sortKey, after) > 0)
    : sorted;
  const page = rest.slice(0, limit);

  return {
    ...header,
    people: page.map((item) => item.row),
    next:
      rest.length > limit ? encodeCursor(page[page.length - 1].sortKey) : null,
  };
};

/**
 * Everything getPayPeriodDetail pages over: the period's header and every
 * person with incidencias in it, in name order (the MCP tool pages it with
 * its own signed cursors).
 */
export const loadPayPeriodIncidencias = async (
  companyId: string,
  period: string,
): Promise<
  Omit<PayPeriodDetail, "people" | "next"> & {
    sorted: Array<{ sortKey: string[]; row: PeriodPersonRow }>;
  }
> => {
  const range = quincenaRange(period);
  const row = await getPayPeriod(companyId, period);
  const closed = row?.status === "closed";
  const counts: Array<
    { personId: string } & IncidenciaTotals & { kind: string }
  > = closed
    ? ((await readPeriodSnapshot(companyId, period))?.rows ?? [])
    : (await incidenciasBy(companyId, range, { by: "person" })).flatMap(
        (item) => (item.key ? [{ ...item, personId: item.key }] : []),
      );

  const totals: Record<string, IncidenciaTotals> = {};
  const byPerson = new Map<string, Record<string, IncidenciaTotals>>();

  for (const item of counts) {
    const total = (totals[item.kind] ??= {
      count: 0,
      justified: 0,
      minutes: 0,
    });
    total.count += item.count;
    total.justified += item.justified;
    total.minutes += item.minutes;

    const kinds = byPerson.get(item.personId) ?? {};
    kinds[item.kind] = {
      count: item.count,
      justified: item.justified,
      minutes: item.minutes,
    };
    byPerson.set(item.personId, kinds);
  }

  const ids = [...byPerson.keys()];
  const names =
    ids.length === 0
      ? []
      : await tdb(companyId)
          .select({
            id: people.id,
            nombres: people.nombres,
            apellidoPaterno: people.apellidoPaterno,
            apellidoMaterno: people.apellidoMaterno,
          })
          .from(people)
          .where(withTenant(people, companyId, inArray(people.id, ids)));

  const sorted = names
    .map((person) => ({
      sortKey: [
        person.apellidoPaterno.toLocaleLowerCase("es-MX"),
        person.nombres.toLocaleLowerCase("es-MX"),
        person.id,
      ],
      row: {
        personId: person.id,
        name: formatPersonName(person),
        kinds: byPerson.get(person.id) ?? {},
      },
    }))
    .sort((a, b) => compareTuple(a.sortKey, b.sortKey));

  return {
    period,
    label: quincenaLabel(period),
    startsOn: range.from,
    endsOn: range.to,
    status: closed ? "closed" : "open",
    closedAt: row?.closedAt ?? null,
    revision: row?.revision ?? 0,
    source: closed ? "snapshot" : "live",
    totals,
    personCount: sorted.length,
    sorted,
  };
};
