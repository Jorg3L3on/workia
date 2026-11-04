import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbTransaction } from "@/lib/db";
import {
  contracts,
  employmentPeriods,
  incidenciaJustifications,
  incidenciaRules,
  people,
  personEvents,
  personSchedules,
  vacationRecords,
  type IncidenciaJustification,
  type IncidenciaJustificationKind,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import { lockOpenPayPeriod } from "@/lib/pay-periods/lock";
import {
  PayPeriodError,
  quincenaOf,
  quincenaRange,
} from "@/lib/pay-periods/quincena";
import { withTenant } from "@/lib/tenant/scope";
import { attendanceDedupeKey } from "@/lib/timeline";
import type { IncidenciaKind } from "@/lib/timeline/events";
import {
  readAttendance,
  replacePeriodIncidencias,
  type IncidenciasWriteResult,
} from "@/lib/timeline/writers";

import { justificationKindLabel } from "./copy";
import { addDays, eachDay } from "./days";
import {
  computeIncidencias,
  type EngineIncidencia,
  type EnginePersonInput,
} from "./engine";
import {
  firstPeriodForChange,
  rulesForPeriod,
  rulesProblem,
  type IncidenciaRules,
} from "./rules";

export { computeIncidencias } from "./engine";
export {
  DEFAULT_INCIDENCIA_RULES,
  firstPeriodForChange,
  nextQuincena,
  rulesForPeriod,
  type IncidenciaRules,
} from "./rules";

/**
 * The incidencias engine against the database (Workia 2.0 W2-14,
 * docs/incidencias.md). runIncidencias loads one quincena of a company's
 * people (attendance, schedules, contracts, employment, vacations,
 * justifications and the period's rules), computes their incidencias and
 * writes them with replacePeriodIncidencias, in one transaction that holds
 * the period open. Closed periods are refused (PayPeriodError
 * 'period_closed'). HR's decisions (rules, permisos, incapacidades,
 * overrides) each leave an audit event and recompute what they touch.
 */

/** People loaded and computed per round trip. */
const PEOPLE_BATCH = 200;

export const MAX_JUSTIFICATION_REASON = 280;
export const MAX_JUSTIFICATION_REFERENCE = 80;
/** A permiso or incapacidad spans at most this many days. */
export const MAX_JUSTIFICATION_DAYS = 366;

export class IncidenciaError extends Error {
  constructor(
    readonly code:
      | "invalid_rules"
      | "invalid_dates"
      | "reason_required"
      | "not_found"
      | "already_cancelled",
    message: string,
  ) {
    super(message);
    this.name = "IncidenciaError";
  }
}

// ---------------------------------------------------------------- rules

const rulesColumns = {
  effectivePeriod: incidenciaRules.effectivePeriod,
  retardoToleranceMinutes: incidenciaRules.retardoToleranceMinutes,
  salidaToleranceMinutes: incidenciaRules.salidaToleranceMinutes,
  faltaAfterMinutes: incidenciaRules.faltaAfterMinutes,
  createdAt: incidenciaRules.createdAt,
};

/** The company's rules changes, newest first. */
export const listIncidenciaRules = async (companyId: string) =>
  tdb(companyId)
    .select(rulesColumns)
    .from(incidenciaRules)
    .where(withTenant(incidenciaRules, companyId))
    .orderBy(desc(incidenciaRules.effectivePeriod))
    .limit(48);

const rulesOf = async (
  executor: DbTransaction | ReturnType<typeof tdb>,
  companyId: string,
  period: string,
) => {
  const [row] = await executor
    .select(rulesColumns)
    .from(incidenciaRules)
    .where(
      withTenant(
        incidenciaRules,
        companyId,
        lte(incidenciaRules.effectivePeriod, period),
      ),
    )
    .orderBy(desc(incidenciaRules.effectivePeriod))
    .limit(1);

  return rulesForPeriod(row ? [row] : [], period);
};

/** The rules the engine applies to `period` (the defaults when none were saved). */
export const getIncidenciaRules = async (companyId: string, period: string) => {
  quincenaRange(period);

  return rulesOf(tdb(companyId), companyId, period);
};

/**
 * Saves HR's rules. They start in the quincena after today's, so the running
 * period keeps the rules it started with; saving twice before then replaces
 * the pending change. Leaves an audit event with the before and after.
 */
export const saveIncidenciaRules = async (
  companyId: string,
  rules: IncidenciaRules,
  options: { actorUserId?: string | null; today?: string } = {},
) => {
  const problem = rulesProblem(rules);

  if (problem) throw new IncidenciaError("invalid_rules", problem);

  const effectivePeriod = firstPeriodForChange(options.today ?? isoToday());

  return withTransaction(async (tx) => {
    const before = await rulesOf(tx, companyId, effectivePeriod);

    await tx
      .insert(incidenciaRules)
      .values({
        companyId,
        effectivePeriod,
        ...rules,
        createdBy: options.actorUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [incidenciaRules.companyId, incidenciaRules.effectivePeriod],
        set: {
          ...rules,
          createdBy: options.actorUserId ?? null,
          createdAt: new Date(),
        },
      });

    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "incidencia_rules",
        resourceId: effectivePeriod,
        action: "update",
        payload: {
          summary: `Reglas de incidencias desde ${effectivePeriod}`,
          before: {
            retardoToleranceMinutes: before.retardoToleranceMinutes,
            salidaToleranceMinutes: before.salidaToleranceMinutes,
            faltaAfterMinutes: before.faltaAfterMinutes,
          },
          after: { ...rules },
        },
      },
      tx,
    );

    return { effectivePeriod, ...rules };
  }, companyId);
};

// ---------------------------------------------------------------- loading

type PersonRow = { id: string; siteId: string | null };

const loadInputs = async (
  tx: DbTransaction,
  companyId: string,
  batch: PersonRow[],
  range: { from: string; to: string },
): Promise<EnginePersonInput[]> => {
  const ids = batch.map((person) => person.id);
  const wide = { from: addDays(range.from, -1), to: addDays(range.to, 1) };
  const [
    contractRows,
    scheduleRows,
    employmentRows,
    vacationRows,
    justificationRows,
    attendanceRows,
  ] = await Promise.all([
    tx
      .select({
        personId: contracts.personId,
        from: contracts.startDate,
        to: contracts.endDate,
        blocks: contracts.scheduleBlocks,
        entrada: contracts.scheduleEntrada,
        salida: contracts.scheduleSalida,
        restDay: contracts.scheduleRestDay,
      })
      .from(contracts)
      .where(
        withTenant(
          contracts,
          companyId,
          inArray(contracts.personId, ids),
          isNull(contracts.deletedAt),
          lte(contracts.startDate, wide.to),
          or(isNull(contracts.endDate), gte(contracts.endDate, wide.from)),
        ),
      ),
    tx
      .select({
        personId: personSchedules.personId,
        blocks: personSchedules.blocks,
        entrada: personSchedules.entrada,
        salida: personSchedules.salida,
        restDay: personSchedules.restDay,
      })
      .from(personSchedules)
      .where(
        withTenant(
          personSchedules,
          companyId,
          inArray(personSchedules.personId, ids),
          isNull(personSchedules.deletedAt),
        ),
      ),
    tx
      .select({
        personId: employmentPeriods.personId,
        from: employmentPeriods.fechaIngreso,
        to: employmentPeriods.fechaBaja,
      })
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          inArray(employmentPeriods.personId, ids),
        ),
      ),
    tx
      .select({
        id: vacationRecords.id,
        personId: vacationRecords.personId,
        fromDay: vacationRecords.startDate,
        toDay: vacationRecords.endDate,
      })
      .from(vacationRecords)
      .where(
        withTenant(
          vacationRecords,
          companyId,
          inArray(vacationRecords.personId, ids),
          isNull(vacationRecords.voidedAt),
          lte(vacationRecords.startDate, range.to),
          gte(vacationRecords.endDate, range.from),
        ),
      ),
    tx
      .select({
        id: incidenciaJustifications.id,
        personId: incidenciaJustifications.personId,
        kind: incidenciaJustifications.kind,
        fromDay: incidenciaJustifications.fromDay,
        toDay: incidenciaJustifications.toDay,
        incidenciaKind: incidenciaJustifications.incidenciaKind,
        effect: incidenciaJustifications.effect,
      })
      .from(incidenciaJustifications)
      .where(
        withTenant(
          incidenciaJustifications,
          companyId,
          inArray(incidenciaJustifications.personId, ids),
          isNull(incidenciaJustifications.cancelledAt),
          lte(incidenciaJustifications.fromDay, range.to),
          gte(incidenciaJustifications.toDay, range.from),
        ),
      )
      .orderBy(asc(incidenciaJustifications.createdAt)),
    tx
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
          inArray(personEvents.personId, ids),
          inArray(
            personEvents.dedupeKey,
            eachDay(wide.from, wide.to).map(attendanceDedupeKey),
          ),
        ),
      ),
  ]);

  const group = <T extends { personId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();

    for (const row of rows) {
      map.set(row.personId, [...(map.get(row.personId) ?? []), row]);
    }

    return map;
  };
  const byContract = group(contractRows);
  const bySchedule = new Map(scheduleRows.map((row) => [row.personId, row]));
  const byEmployment = group(employmentRows);
  const byVacation = group(vacationRows);
  const byJustification = group(justificationRows);
  const byAttendance = group(attendanceRows);

  return batch.map((person) => {
    const attendance = (byAttendance.get(person.id) ?? []).map((row) => ({
      day: (row.dedupeKey ?? "").replace(/^attendance:/, ""),
      ...readAttendance(row.payload),
    }));
    const schedule = bySchedule.get(person.id);

    return {
      personId: person.id,
      siteId: person.siteId,
      employment: (byEmployment.get(person.id) ?? []).map((row) => ({
        from: row.from,
        to: row.to,
      })),
      contracts: (byContract.get(person.id) ?? []).map((row) => ({
        from: row.from,
        to: row.to,
        blocks: row.blocks,
        entrada: row.entrada,
        salida: row.salida,
        restDay: row.restDay,
      })),
      personSchedule: schedule
        ? {
            blocks: schedule.blocks,
            entrada: schedule.entrada,
            salida: schedule.salida,
            restDay: schedule.restDay,
          }
        : null,
      punches: attendance.flatMap((day) =>
        day.punches.map((punch) => ({ at: punch.at, kind: punch.kind })),
      ),
      attendanceSites: Object.fromEntries(
        attendance.map((day) => [day.day, day.siteId]),
      ),
      justifications: (byJustification.get(person.id) ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        fromDay: row.fromDay,
        toDay: row.toDay,
        incidenciaKind: row.incidenciaKind,
        effect: row.effect,
      })),
      vacations: (byVacation.get(person.id) ?? []).map((row) => ({
        id: row.id,
        fromDay: row.fromDay,
        toDay: row.toDay,
      })),
    };
  });
};

// ---------------------------------------------------------------- engine run

export type IncidenciasRunResult = IncidenciasWriteResult & {
  period: string;
  people: number;
  incidencias: number;
};

/**
 * Computes and writes the incidencias of one open quincena: every person of
 * the company who is not deleted, or only `personIds`. In the caller's
 * transaction when given one, otherwise in its own. A shift counts once it
 * has ended by `asOf` (now), so a running period fills in day by day.
 */
export const runIncidencias = async (
  companyId: string,
  period: string,
  options: { personIds?: string[]; asOf?: Date; tx?: DbTransaction } = {},
): Promise<IncidenciasRunResult> => {
  const range = quincenaRange(period);
  const asOf = options.asOf ?? new Date();

  const run = async (tx: DbTransaction) => {
    // Hold the period open first: a closed one writes nothing.
    await lockOpenPayPeriod(tx, companyId, period);

    const rules = await rulesOf(tx, companyId, period);
    const roster = await tx
      .select({ id: people.id, siteId: people.siteId })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          isNull(people.deletedAt),
          options.personIds ? inArray(people.id, options.personIds) : undefined,
        ),
      )
      .orderBy(asc(people.id));
    const result: IncidenciasRunResult = {
      period,
      people: roster.length,
      incidencias: 0,
      inserted: 0,
      deleted: 0,
      unchanged: 0,
    };

    for (let start = 0; start < roster.length; start += PEOPLE_BATCH) {
      const batch = roster.slice(start, start + PEOPLE_BATCH);
      const inputs = await loadInputs(tx, companyId, batch, range);
      const incidencias: EngineIncidencia[] = inputs.flatMap((input) =>
        computeIncidencias(input, range, rules, asOf),
      );
      const written = await replacePeriodIncidencias(
        companyId,
        {
          period,
          personIds: batch.map((person) => person.id),
          incidencias: incidencias.map((item) => ({
            personId: item.personId,
            day: item.day,
            kind: item.kind,
            minutes: item.minutes,
            justified: item.justified,
            justificationRef: item.justificationRef,
            voided: item.voided,
            siteId: item.siteId,
            source: "engine",
          })),
        },
        tx,
      );

      result.incidencias += incidencias.length;
      result.inserted += written.inserted;
      result.deleted += written.deleted;
      result.unchanged += written.unchanged;
    }

    return result;
  };

  return options.tx ? run(options.tx) : withTransaction(run, companyId);
};

/**
 * The quincenas a punch of `day` can change: its own, and the one before
 * when the day is the first of a quincena (a night shift that started the
 * evening before ends on it).
 */
export const periodsTouchedBy = (day: string) =>
  [...new Set([quincenaOf(addDays(day, -1)), quincenaOf(day)])].sort();

/**
 * Recomputes the people and quincenas that new attendance touched, after the
 * ingestion committed. A closed quincena is skipped: its punches are stored,
 * and its incidencias change only after a reopen. Returns the quincenas
 * computed.
 */
export const recomputeAfterAttendance = async (
  companyId: string,
  days: Array<{ personId: string; day: string }>,
  options: { asOf?: Date } = {},
) => {
  const byPeriod = new Map<string, Set<string>>();

  for (const { personId, day } of days) {
    for (const period of periodsTouchedBy(day)) {
      byPeriod.set(period, (byPeriod.get(period) ?? new Set()).add(personId));
    }
  }

  const computed: string[] = [];

  for (const [period, personIds] of [...byPeriod].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    try {
      await runIncidencias(companyId, period, {
        personIds: [...personIds],
        asOf: options.asOf,
      });
      computed.push(period);
    } catch (error) {
      if (error instanceof PayPeriodError && error.code === "period_closed") {
        continue;
      }

      throw error;
    }
  }

  return computed;
};

// ---------------------------------------------------------------- justifications

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const quincenasBetween = (from: string, to: string) => {
  const periods: string[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) {
    const period = quincenaOf(day);

    if (periods.at(-1) !== period) periods.push(period);
  }

  return periods;
};

const assertPerson = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
) => {
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!person) {
    throw new IncidenciaError("not_found", "Esa persona no existe.");
  }
};

/** Recomputes one person's quincenas from `from` to `to`, all of them open. */
const recomputePerson = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  from: string,
  to: string,
  asOf?: Date,
) => {
  for (const period of quincenasBetween(from, to)) {
    await runIncidencias(companyId, period, {
      personIds: [personId],
      asOf,
      tx,
    });
  }
};

const cleanText = (value: string | null | undefined, max: number) => {
  const text = (value ?? "").trim();

  return text.length > 0 ? text.slice(0, max) : null;
};

export type JustificationInput = {
  personId: string;
  kind: Exclude<IncidenciaJustificationKind, "override">;
  fromDay: string;
  toDay: string;
  reason: string;
  reference?: string | null;
};

const insertJustification = async (
  tx: DbTransaction,
  companyId: string,
  values: {
    personId: string;
    kind: IncidenciaJustificationKind;
    fromDay: string;
    toDay: string;
    incidenciaKind: IncidenciaKind | null;
    effect: "justify" | "void";
    reason: string;
    reference: string | null;
  },
  actorUserId: string | null,
) => {
  const [row] = await tx
    .insert(incidenciaJustifications)
    .values({ companyId, ...values, createdBy: actorUserId })
    .returning();

  return row;
};

const validateDays = (fromDay: string, toDay: string) => {
  if (!DAY.test(fromDay) || !DAY.test(toDay) || toDay < fromDay) {
    throw new IncidenciaError(
      "invalid_dates",
      "Revisa las fechas: el fin no puede ser antes del inicio.",
    );
  }

  quincenaOf(fromDay);
  quincenaOf(toDay);

  if (eachDay(fromDay, toDay).length > MAX_JUSTIFICATION_DAYS) {
    throw new IncidenciaError(
      "invalid_dates",
      `Una justificación cubre hasta ${MAX_JUSTIFICATION_DAYS} días.`,
    );
  }
};

/**
 * Registers a permiso or an IMSS incapacidad: the person's incidencias of
 * those days become justified. Every quincena it touches must be open
 * (PayPeriodError 'period_closed' otherwise); they are recomputed in the
 * same transaction, with an audit event.
 */
export const createJustification = async (
  companyId: string,
  input: JustificationInput,
  options: { actorUserId?: string | null; asOf?: Date } = {},
) => {
  validateDays(input.fromDay, input.toDay);
  const reason = cleanText(input.reason, MAX_JUSTIFICATION_REASON);

  if (!reason) {
    throw new IncidenciaError("reason_required", "Escribe el motivo.");
  }

  if (input.kind === ("override" as string)) {
    throw new IncidenciaError("invalid_dates", "Usa overrideIncidencia.");
  }

  return withTransaction(async (tx) => {
    await assertPerson(tx, companyId, input.personId);
    const row = await insertJustification(
      tx,
      companyId,
      {
        personId: input.personId,
        kind: input.kind,
        fromDay: input.fromDay,
        toDay: input.toDay,
        incidenciaKind: null,
        effect: "justify",
        reason,
        reference: cleanText(input.reference, MAX_JUSTIFICATION_REFERENCE),
      },
      options.actorUserId ?? null,
    );

    await recomputePerson(
      tx,
      companyId,
      input.personId,
      input.fromDay,
      input.toDay,
      options.asOf,
    );
    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "incidencia_justification",
        resourceId: row.id,
        action: "create",
        payload: {
          summary: `${justificationKindLabel[row.kind]} del ${row.fromDay} al ${row.toDay}`,
          after: {
            personId: row.personId,
            kind: row.kind,
            fromDay: row.fromDay,
            toDay: row.toDay,
            reason,
            reference: row.reference,
          },
        },
      },
      tx,
    );

    return row;
  }, companyId);
};

/**
 * HR's decision on one incidencia of one day: justify it or void it, with a
 * reason. The latest decision on a day and kind wins. The quincena must be
 * open; it is recomputed in the same transaction and the decision leaves an
 * audit event (incidencia_justification / override).
 */
export const overrideIncidencia = async (
  companyId: string,
  input: {
    personId: string;
    day: string;
    kind: IncidenciaKind;
    effect: "justify" | "void";
    reason: string;
  },
  options: { actorUserId?: string | null; asOf?: Date } = {},
) => {
  validateDays(input.day, input.day);
  const reason = cleanText(input.reason, MAX_JUSTIFICATION_REASON);

  if (!reason) {
    throw new IncidenciaError("reason_required", "Escribe el motivo.");
  }

  if (!["falta", "retardo", "salida_anticipada"].includes(input.kind)) {
    throw new IncidenciaError("not_found", "Tipo de incidencia inválido.");
  }

  return withTransaction(async (tx) => {
    await assertPerson(tx, companyId, input.personId);
    const row = await insertJustification(
      tx,
      companyId,
      {
        personId: input.personId,
        kind: "override",
        fromDay: input.day,
        toDay: input.day,
        incidenciaKind: input.kind,
        effect: input.effect,
        reason,
        reference: null,
      },
      options.actorUserId ?? null,
    );

    await recomputePerson(
      tx,
      companyId,
      input.personId,
      input.day,
      input.day,
      options.asOf,
    );
    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "incidencia_justification",
        resourceId: row.id,
        action: "override",
        payload: {
          summary: `${input.effect === "void" ? "Anuló" : "Justificó"} ${input.kind} del ${input.day}`,
          after: {
            personId: input.personId,
            day: input.day,
            kind: input.kind,
            effect: input.effect,
            reason,
          },
        },
      },
      tx,
    );

    return row;
  }, companyId);
};

/**
 * Cancels a permiso, incapacidad or override: the row stays with who
 * cancelled it and why, and its days are recomputed (they must be open).
 */
export const cancelJustification = async (
  companyId: string,
  justificationId: string,
  options: { reason: string; actorUserId?: string | null; asOf?: Date },
) => {
  const reason = cleanText(options.reason, MAX_JUSTIFICATION_REASON);

  if (!reason) {
    throw new IncidenciaError("reason_required", "Escribe el motivo.");
  }

  return withTransaction(async (tx) => {
    const [row] = await tx
      .update(incidenciaJustifications)
      .set({
        cancelledAt: new Date(),
        cancelledBy: options.actorUserId ?? null,
        cancelReason: reason,
      })
      .where(
        withTenant(
          incidenciaJustifications,
          companyId,
          eq(incidenciaJustifications.id, justificationId),
          isNull(incidenciaJustifications.cancelledAt),
        ),
      )
      .returning();

    if (!row) {
      throw new IncidenciaError(
        "not_found",
        "Esa justificación no existe o ya estaba cancelada.",
      );
    }

    await recomputePerson(
      tx,
      companyId,
      row.personId,
      row.fromDay,
      row.toDay,
      options.asOf,
    );
    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "incidencia_justification",
        resourceId: row.id,
        action: "revoke",
        payload: {
          summary: `Canceló ${justificationKindLabel[row.kind].toLowerCase()} del ${row.fromDay} al ${row.toDay}`,
          before: { cancelledAt: null },
          after: { personId: row.personId, cancelReason: reason },
        },
      },
      tx,
    );

    return row;
  }, companyId);
};

/** A person's justifications that touch `from`..`to`, cancelled ones included, oldest first. */
export const listJustifications = async (
  companyId: string,
  personId: string,
  range: { from: string; to: string },
): Promise<IncidenciaJustification[]> =>
  tdb(companyId)
    .select()
    .from(incidenciaJustifications)
    .where(
      withTenant(
        incidenciaJustifications,
        companyId,
        eq(incidenciaJustifications.personId, personId),
        lte(incidenciaJustifications.fromDay, range.to),
        gte(incidenciaJustifications.toDay, range.from),
      ),
    )
    .orderBy(asc(incidenciaJustifications.createdAt))
    .limit(200);

export type PersonDayIncidencia = {
  day: string;
  kind: IncidenciaKind;
  minutes: number | null;
  justified: boolean;
  justificationRef: string | null;
  voided: boolean;
};

/**
 * One person's quincena for the HR screen: their name, the incidencias
 * written for it (voided ones included) and the first and last punch of
 * each day. Null when the person is not in the company.
 */
export const getPersonPeriodIncidencias = async (
  companyId: string,
  period: string,
  personId: string,
) => {
  const range = quincenaRange(period);
  const scoped = tdb(companyId);
  const [person] = await scoped
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(withTenant(people, companyId, eq(people.id, personId)))
    .limit(1);

  if (!person) return null;

  const events = await scoped
    .select({
      type: personEvents.type,
      dedupeKey: personEvents.dedupeKey,
      payload: personEvents.payload,
    })
    .from(personEvents)
    .where(
      withTenant(
        personEvents,
        companyId,
        eq(personEvents.personId, personId),
        inArray(personEvents.type, ["attendance", "incidencia"]),
        gte(
          personEvents.occurredAt,
          new Date(`${addDays(range.from, -1)}T00:00:00Z`),
        ),
        lte(
          personEvents.occurredAt,
          new Date(`${addDays(range.to, 2)}T00:00:00Z`),
        ),
      ),
    )
    .orderBy(asc(personEvents.occurredAt))
    .limit(400);

  const incidencias: PersonDayIncidencia[] = [];
  const punches: Record<string, { first: string | null; last: string | null }> =
    {};

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    if (event.type === "incidencia") {
      if (payload.period !== period) continue;

      incidencias.push({
        day: String(payload.date),
        kind: payload.kind as IncidenciaKind,
        minutes: typeof payload.minutes === "number" ? payload.minutes : null,
        justified: payload.justified === true,
        justificationRef:
          typeof payload.justification_ref === "string"
            ? payload.justification_ref
            : null,
        voided: payload.voided === true,
      });
      continue;
    }

    const day = (event.dedupeKey ?? "").replace(/^attendance:/, "");

    if (day < range.from || day > range.to) continue;

    const read = readAttendance(payload);
    const sorted = read.punches.map((punch) => punch.at).sort();
    punches[day] = { first: sorted[0] ?? null, last: sorted.at(-1) ?? null };
  }

  incidencias.sort(
    (a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind),
  );

  return { person, range, incidencias, punches };
};
