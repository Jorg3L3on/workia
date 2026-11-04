import { addDays, weekdayIndex } from "./days";

/**
 * Mandatory rest days of the Ley Federal del Trabajo, article 74: nobody has
 * a falta on them. Election days (section IX) are set by the electoral law
 * each time, so HR justifies them with an override.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** The nth Monday of a month (1-based). */
const nthMonday = (year: number, month: number, nth: number) => {
  const first = `${year}-${pad(month)}-01`;
  const offset = (8 - weekdayIndex(first)) % 7;

  return addDays(first, offset + (nth - 1) * 7);
};

const cache = new Map<number, Set<string>>();

/** The article 74 days of a year. */
export const lftHolidays = (year: number) => {
  const known = cache.get(year);

  if (known) return known;

  const days = new Set([
    `${year}-01-01`,
    nthMonday(year, 2, 1),
    nthMonday(year, 3, 3),
    `${year}-05-01`,
    `${year}-09-16`,
    nthMonday(year, 11, 3),
    `${year}-12-25`,
  ]);

  // Transmission of the federal executive power: 1 October every six years
  // from 2024.
  if (year >= 2024 && (year - 2024) % 6 === 0) days.add(`${year}-10-01`);

  cache.set(year, days);

  return days;
};

export const isLftHoliday = (day: string) =>
  lftHolidays(Number(day.slice(0, 4))).has(day);
