import { DISPLAY_TIME_ZONE } from "@/lib/format/date";

/**
 * Local wall time ↔ instant for attendance. Checadores print the local time
 * of the site with no offset; workia reads it in DISPLAY_TIME_ZONE, the same
 * zone the attendance day key (attendance:<date>) and the today view use.
 */

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const zonedParts = (instant: Date) => {
  const parts = Object.fromEntries(
    partsFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

  return parts;
};

/** Minutes the zone is ahead of UTC at that instant (Mexico City: -360). */
const offsetMinutes = (instant: Date) => {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );

  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000,
  );
};

export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const validWallTime = (t: WallTime) => {
  if (t.year < 2000 || t.year > 2100) return false;
  if (t.month < 1 || t.month > 12) return false;
  if (t.hour > 23 || t.minute > 59 || t.second > 59) return false;
  if (t.hour < 0 || t.minute < 0 || t.second < 0) return false;
  const days = new Date(Date.UTC(t.year, t.month, 0)).getUTCDate();

  return t.day >= 1 && t.day <= days;
};

/** The instant of a local wall time in DISPLAY_TIME_ZONE, or null when it is not a real time. */
export const instantFromWallTime = (t: WallTime): Date | null => {
  if (!validWallTime(t)) return null;

  const guess = Date.UTC(
    t.year,
    t.month - 1,
    t.day,
    t.hour,
    t.minute,
    t.second,
  );
  // Two passes settle the offset, also across an offset change.
  let instant = new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  instant = new Date(guess - offsetMinutes(instant) * 60000);

  return instant;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The local date (YYYY-MM-DD) of an instant: the day its attendance row belongs to. */
export const localDay = (instant: Date) => {
  const p = zonedParts(instant);

  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** Local HH:mm of an instant, for screens. */
export const localTime = (instant: Date) => {
  const p = zonedParts(instant);

  return `${pad(p.hour)}:${pad(p.minute)}`;
};
