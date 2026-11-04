import { instantFromWallTime } from "@/lib/attendance/time";
import type { ScheduleBlock, WeekDay } from "@/lib/people/schedule-blocks";

import { addDays, weekdayIndex } from "./days";

/**
 * Which shift a person has on a day (W2-14). The schedule comes from the
 * contract in effect on that date, so a new contract in the middle of a
 * quincena changes the shifts from its start date; with no contract schedule
 * that day, from the person's own schedule. A schedule is either by blocks
 * (WRK-I5-3: weekdays with an entry and an exit) or simple (one entry and
 * exit every day but the rest day). An exit at or before the entry is a
 * night shift that ends the next day; it belongs to the day it starts.
 * Pure: no database access here.
 */

export type ScheduleSpec = {
  blocks: ScheduleBlock[] | null;
  entrada: string | null;
  salida: string | null;
  restDay: WeekDay | null;
};

export type ContractSchedule = ScheduleSpec & {
  /** Start date of the contract, YYYY-MM-DD. */
  from: string;
  /** End date, inclusive; null while it has none. */
  to: string | null;
};

export type ShiftTimes = { entrada: string; salida: string };

export type Shift = {
  /** The local day the shift starts. */
  day: string;
  start: Date;
  end: Date;
};

const WEEKDAY_BY_INDEX: WeekDay[] = [
  "dom",
  "lun",
  "mar",
  "mie",
  "jue",
  "vie",
  "sab",
];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const hasSchedule = (spec: ScheduleSpec) =>
  (spec.blocks?.length ?? 0) > 0 ||
  Boolean(spec.entrada && spec.salida && TIME.test(spec.entrada));

/** The entry and exit of a schedule on a weekday, or null when it is not a workday. */
export const shiftTimesOn = (
  spec: ScheduleSpec,
  weekday: WeekDay,
): ShiftTimes | null => {
  if (spec.blocks && spec.blocks.length > 0) {
    const block = spec.blocks.find((candidate) =>
      candidate.dias.includes(weekday),
    );

    return block ? { entrada: block.entrada, salida: block.salida } : null;
  }

  if (!spec.entrada || !spec.salida) return null;

  // A simple schedule without a rest day rests on Sunday, as the LFT's
  // article 69 suggests.
  return weekday === (spec.restDay ?? "dom")
    ? null
    : { entrada: spec.entrada, salida: spec.salida };
};

/**
 * The schedule in effect on a day: the contract covering it with a schedule
 * (the latest one when two overlap), otherwise the person's.
 */
export const scheduleOn = (
  day: string,
  contracts: ContractSchedule[],
  personSchedule: ScheduleSpec | null,
): ScheduleSpec | null => {
  const contract = contracts
    .filter(
      (candidate) =>
        candidate.from <= day &&
        (candidate.to === null || candidate.to >= day) &&
        hasSchedule(candidate),
    )
    .sort((a, b) => b.from.localeCompare(a.from))[0];

  if (contract) return contract;

  return personSchedule && hasSchedule(personSchedule) ? personSchedule : null;
};

const wallInstant = (day: string, time: string) => {
  const match = TIME.exec(time);

  if (!match) return null;

  const [year, month, date] = day.split("-").map(Number);

  return instantFromWallTime({
    year,
    month,
    day: date,
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0,
  });
};

/** The shift of one day as instants, or null on a rest day or with no schedule. */
export const shiftOn = (
  day: string,
  contracts: ContractSchedule[],
  personSchedule: ScheduleSpec | null,
): Shift | null => {
  const spec = scheduleOn(day, contracts, personSchedule);
  const times = spec
    ? shiftTimesOn(spec, WEEKDAY_BY_INDEX[weekdayIndex(day)])
    : null;

  if (!times) return null;

  const start = wallInstant(day, times.entrada);
  const overnight = times.salida <= times.entrada;
  const end = wallInstant(overnight ? addDays(day, 1) : day, times.salida);

  return start && end ? { day, start, end } : null;
};
