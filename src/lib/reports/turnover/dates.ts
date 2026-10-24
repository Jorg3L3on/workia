/**
 * Calendar arithmetic on ISO dates (`YYYY-MM-DD`, no time) for the turnover
 * report. Days are counted in UTC so a date never shifts with the time zone.
 */

const DAY_MS = 86_400_000;

/** Whole days since 1970-01-01. */
export const dayNumber = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);

  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
};

export const fromDayNumber = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) =>
  fromDayNumber(dayNumber(iso) + days);

/** b − a in days. */
export const daysBetween = (a: string, b: string) =>
  dayNumber(b) - dayNumber(a);

/** `YYYY-MM` of a date. */
export const monthKey = (iso: string) => iso.slice(0, 7);

export const monthFirstDay = (month: string) => `${month}-01`;

export const monthLastDay = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();

  return `${month}-${String(last).padStart(2, "0")}`;
};

export const daysInMonth = (month: string) =>
  daysBetween(monthFirstDay(month), monthLastDay(month)) + 1;

export const addMonths = (month: string, count: number) => {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + count;

  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

/** Every `YYYY-MM` from the month of `from` to the month of `to`. */
export const monthsBetween = (from: string, to: string) => {
  const months: string[] = [];

  for (
    let month = monthKey(from);
    month <= monthKey(to);
    month = addMonths(month, 1)
  ) {
    months.push(month);
  }

  return months;
};

/** True when the range is whole calendar months (1st to last day). */
export const isWholeMonths = (from: string, to: string) =>
  from === monthFirstDay(monthKey(from)) && to === monthLastDay(monthKey(to));

/** The same range moved by whole months (keeps whole months whole). */
export const shiftRangeByMonths = (
  from: string,
  to: string,
  months: number,
) => {
  if (isWholeMonths(from, to)) {
    return {
      from: monthFirstDay(addMonths(monthKey(from), months)),
      to: monthLastDay(addMonths(monthKey(to), months)),
    };
  }

  const shift = (iso: string) => {
    const month = addMonths(monthKey(iso), months);
    const day = Math.min(Number(iso.slice(8)), daysInMonth(month));

    return `${month}-${String(day).padStart(2, "0")}`;
  };

  return { from: shift(from), to: shift(to) };
};

/** The range of the same length right before this one. */
export const previousRange = (from: string, to: string) => {
  if (isWholeMonths(from, to)) {
    return shiftRangeByMonths(from, to, -monthsBetween(from, to).length);
  }

  const length = daysBetween(from, to) + 1;

  return { from: addDays(from, -length), to: addDays(from, -1) };
};
