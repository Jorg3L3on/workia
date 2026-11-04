/** Calendar arithmetic on local days ('YYYY-MM-DD'), with no time zone involved. */

const pad = (value: number) => String(value).padStart(2, "0");

const toUtc = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);

  return Date.UTC(year, month - 1, date);
};

const fromUtc = (time: number) => {
  const at = new Date(time);

  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};

/** The day `offset` days after `day` (before, when negative). */
export const addDays = (day: string, offset: number) =>
  fromUtc(toUtc(day) + offset * 86_400_000);

/** Every day from `from` to `to`, both included. */
export const eachDay = (from: string, to: string) => {
  const days: string[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);

  return days;
};

/** 0 for Sunday to 6 for Saturday. */
export const weekdayIndex = (day: string) => new Date(toUtc(day)).getUTCDay();
