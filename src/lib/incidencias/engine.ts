import type { IncidenciaJustificationKind } from "@/lib/db/schema/incidencias";
import type { IncidenciaKind } from "@/lib/timeline/events";

import { addDays, eachDay } from "./days";
import { isLftHoliday } from "./holidays";
import type { IncidenciaRules } from "./rules";
import {
  shiftOn,
  type ContractSchedule,
  type ScheduleSpec,
  type Shift,
} from "./schedule";

/**
 * The incidencias engine (Workia 2.0 W2-14, docs/incidencias.md): one
 * person's punches and the shifts of their schedule become faltas, retardos
 * and salidas anticipadas for the days of a range, then justifications and
 * HR's overrides mark them justified or void them. Pure: the caller loads
 * the inputs (src/lib/incidencias/index.ts) and writes the result with
 * replacePeriodIncidencias. Overtime is not computed.
 */

/** A punch further than this from every shift belongs to none. */
export const MAX_PUNCH_DISTANCE_MS = 6 * 60 * 60 * 1000;

/** A punch this soon after the one before it is the same punch, read twice. */
export const DOUBLE_PUNCH_MS = 5 * 60 * 1000;

export type EnginePunch = { at: string; kind: "in" | "out" };

export type EngineJustification = {
  id: string;
  kind: IncidenciaJustificationKind;
  fromDay: string;
  toDay: string;
  /** Override only. */
  incidenciaKind: IncidenciaKind | null;
  effect: "justify" | "void";
};

export type EngineVacation = { id: string; fromDay: string; toDay: string };

export type EmploymentSpan = { from: string | null; to: string | null };

export type EnginePersonInput = {
  personId: string;
  siteId: string | null;
  /** Spans of employment; empty when unknown (every day counts). */
  employment: EmploymentSpan[];
  contracts: ContractSchedule[];
  personSchedule: ScheduleSpec | null;
  /** Punches of the range and a day either side, any order. */
  punches: EnginePunch[];
  /** Site of the attendance row of a day, when it has one. */
  attendanceSites?: Record<string, string | null>;
  justifications: EngineJustification[];
  vacations: EngineVacation[];
};

export type EngineIncidencia = {
  personId: string;
  day: string;
  kind: IncidenciaKind;
  minutes: number | null;
  justified: boolean;
  justificationRef: string | null;
  voided: boolean;
  siteId: string | null;
};

const MINUTE = 60_000;

const employedOn = (day: string, employment: EmploymentSpan[]) =>
  employment.length === 0 ||
  employment.some(
    (span) =>
      (span.from === null || span.from <= day) &&
      (span.to === null || span.to >= day),
  );

const distance = (at: number, shift: Shift) =>
  at < shift.start.getTime()
    ? shift.start.getTime() - at
    : at > shift.end.getTime()
      ? at - shift.end.getTime()
      : 0;

/**
 * Each punch goes to the nearest shift (0 inside it), up to six hours away:
 * a night shift's exit after midnight belongs to the day before, and an
 * early arrival to the shift it is early for.
 */
export const assignPunches = (shifts: Shift[], punches: EnginePunch[]) => {
  const byShift = new Map<string, EnginePunch[]>();

  for (const punch of punches) {
    const at = new Date(punch.at).getTime();
    let best: Shift | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const shift of shifts) {
      const gap = distance(at, shift);

      if (gap < bestDistance) {
        best = shift;
        bestDistance = gap;
      }
    }

    if (best && bestDistance <= MAX_PUNCH_DISTANCE_MS) {
      byShift.set(best.day, [...(byShift.get(best.day) ?? []), punch]);
    }
  }

  for (const list of byShift.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at));
  }

  return byShift;
};

/**
 * Entry and exit of a shift's punches. With two or more, the first is the
 * entry and the last the exit whatever kind the checador gave them, so
 * kinds inferred by order do not move the exit. A punch within five minutes
 * of the one before it is a double punch and is dropped. A single punch is
 * an exit only when the source said so.
 */
export const entryAndExit = (all: EnginePunch[]) => {
  const punches: EnginePunch[] = [];

  for (const punch of all) {
    const last = punches.at(-1);

    if (
      last &&
      new Date(punch.at).getTime() - new Date(last.at).getTime() <
        DOUBLE_PUNCH_MS
    ) {
      continue;
    }

    punches.push(punch);
  }

  if (punches.length === 0) return { entry: null, exit: null };

  if (punches.length === 1) {
    const only = new Date(punches[0].at);

    return punches[0].kind === "out"
      ? { entry: null, exit: only }
      : { entry: only, exit: null };
  }

  return {
    entry: new Date(punches[0].at),
    exit: new Date(punches[punches.length - 1].at),
  };
};

type Raw = { kind: IncidenciaKind; minutes: number | null };

/** What the punches of one shift amount to, before any justification. */
export const evaluateShift = (
  shift: Shift,
  punches: EnginePunch[],
  rules: IncidenciaRules,
): Raw[] => {
  const { entry, exit } = entryAndExit(punches);

  if (!entry && !exit) return [{ kind: "falta", minutes: null }];

  const found: Raw[] = [];

  if (entry) {
    const late = Math.floor((entry.getTime() - shift.start.getTime()) / MINUTE);

    if (late > rules.retardoToleranceMinutes) {
      if (rules.faltaAfterMinutes !== null && late > rules.faltaAfterMinutes) {
        return [{ kind: "falta", minutes: null }];
      }

      found.push({ kind: "retardo", minutes: late });
    }
  }

  if (exit) {
    const early = Math.floor((shift.end.getTime() - exit.getTime()) / MINUTE);

    if (early > rules.salidaToleranceMinutes) {
      found.push({ kind: "salida_anticipada", minutes: early });
    }
  }

  return found;
};

const covers = (from: string, to: string, day: string) =>
  from <= day && to >= day;

/**
 * The decision on one incidencia: an override of that day and kind wins
 * (the latest one), then a vacation, then a permiso or incapacidad covering
 * the day.
 */
const decide = (
  day: string,
  kind: IncidenciaKind,
  input: EnginePersonInput,
): { justified: boolean; ref: string | null; voided: boolean } => {
  const override = input.justifications
    .filter(
      (row) =>
        row.kind === "override" &&
        row.incidenciaKind === kind &&
        covers(row.fromDay, row.toDay, day),
    )
    .at(-1);

  if (override) {
    return {
      justified: override.effect === "justify",
      ref: `override:${override.id}`,
      voided: override.effect === "void",
    };
  }

  const vacation = input.vacations.find((row) =>
    covers(row.fromDay, row.toDay, day),
  );

  if (vacation) {
    return { justified: true, ref: `vacation:${vacation.id}`, voided: false };
  }

  const leave = input.justifications.find(
    (row) => row.kind !== "override" && covers(row.fromDay, row.toDay, day),
  );

  if (leave) {
    return { justified: true, ref: `${leave.kind}:${leave.id}`, voided: false };
  }

  return { justified: false, ref: null, voided: false };
};

/**
 * The incidencias of one person for the days `from` to `to`. A shift counts
 * once it has ended by `asOf`; days off, rest days, LFT holidays and days
 * outside employment have none.
 */
export const computeIncidencias = (
  input: EnginePersonInput,
  range: { from: string; to: string },
  rules: IncidenciaRules,
  asOf: Date,
): EngineIncidencia[] => {
  // The day either side claims its own punches (a night shift that ends on
  // the first day of the range, an early arrival for the day after it).
  const shifts = eachDay(addDays(range.from, -1), addDays(range.to, 1))
    .map((day) => shiftOn(day, input.contracts, input.personSchedule))
    .filter((shift): shift is Shift => shift !== null);
  const assigned = assignPunches(shifts, input.punches);
  const result: EngineIncidencia[] = [];

  for (const shift of shifts) {
    const { day } = shift;

    if (day < range.from || day > range.to) continue;
    if (shift.end.getTime() > asOf.getTime()) continue;
    if (!employedOn(day, input.employment)) continue;
    if (isLftHoliday(day)) continue;

    for (const raw of evaluateShift(shift, assigned.get(day) ?? [], rules)) {
      const decision = decide(day, raw.kind, input);

      result.push({
        personId: input.personId,
        day,
        kind: raw.kind,
        minutes: raw.minutes,
        justified: decision.justified,
        justificationRef: decision.ref,
        voided: decision.voided,
        siteId: input.attendanceSites?.[day] ?? input.siteId,
      });
    }
  }

  return result;
};
