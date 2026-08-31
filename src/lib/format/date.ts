export const DISPLAY_LOCALE = "es-MX";
export const DISPLAY_TIME_ZONE = "America/Mexico_City";
export const DATE_DISPLAY_PLACEHOLDER = "dd/mm/aaaa";
export const EMPTY_DATE_LABEL = "—";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MX_SLASH_OR_DASH_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

const pad2 = (value: number | string) => String(value).padStart(2, "0");

const isValidYmd = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const toIsoDate = (year: number, month: number, day: number) => {
  if (!isValidYmd(year, month, day)) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
};

/** Accepts `dd/mm/yyyy`, `dd-mm-yyyy`, or stored `yyyy-mm-dd`. */
export const parseFlexibleDateToIso = (value?: string | null) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const iso = trimmed.match(DATE_ONLY_RE);

  if (iso) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const mexico = trimmed.match(MX_SLASH_OR_DASH_RE);

  if (mexico) {
    return toIsoDate(Number(mexico[3]), Number(mexico[2]), Number(mexico[1]));
  }

  return null;
};

type CalendarParts = {
  year: string;
  month: string;
  day: string;
};

const calendarPartsFromYmd = (value: string): CalendarParts | null => {
  const match = value.trim().match(ISO_DATE_PREFIX_RE);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!isValidYmd(year, month, day)) {
    return null;
  }

  return { year: String(year), month: pad2(month), day: pad2(day) };
};

const partValue = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) => parts.find((part) => part.type === type)?.value;

const calendarPartsFromTimestamp = (date: Date): CalendarParts | null => {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = partValue(parts, "year");
  const month = partValue(parts, "month");
  const day = partValue(parts, "day");

  if (!year || !month || !day) {
    return null;
  }

  return { year, month: pad2(month), day: pad2(day) };
};

const assembleDate = (parts: CalendarParts) =>
  `${parts.day}/${parts.month}/${parts.year}`;

export const looksLikeDateValue = (value: unknown): value is string | Date => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  return DATE_ONLY_RE.test(trimmed) || /^\d{4}-\d{2}-\d{2}T/.test(trimmed);
};

export const formatDateMx = (
  value?: string | Date | null,
  empty: string = EMPTY_DATE_LABEL,
) => {
  if (value == null || value === "") {
    return empty;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (DATE_ONLY_RE.test(trimmed)) {
      const parts = calendarPartsFromYmd(trimmed);
      return parts ? assembleDate(parts) : empty;
    }

    const date = new Date(trimmed);
    const parts = calendarPartsFromTimestamp(date);
    return parts ? assembleDate(parts) : empty;
  }

  const parts = calendarPartsFromTimestamp(value);
  return parts ? assembleDate(parts) : empty;
};

export const formatDateTimeMx = (
  value?: string | Date | null,
  empty: string = EMPTY_DATE_LABEL,
) => {
  if (value == null || value === "") {
    return empty;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return empty;
  }

  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const day = partValue(parts, "day");
  const month = partValue(parts, "month");
  const year = partValue(parts, "year");
  const hour = partValue(parts, "hour");
  const minute = partValue(parts, "minute");

  if (!day || !month || !year || !hour || !minute) {
    return empty;
  }

  return `${pad2(day)}/${pad2(month)}/${year}, ${pad2(hour)}:${pad2(minute)}`;
};

export const formatStoredDateValue = (value: unknown) => {
  if (!looksLikeDateValue(value)) {
    return null;
  }

  if (typeof value === "string" && DATE_ONLY_RE.test(value.trim())) {
    return formatDateMx(value);
  }

  return formatDateTimeMx(value);
};

/** Calendar date in Mexico for form defaults. Does not change stored timezone. */
export const isoToday = (now = new Date()) => {
  const parts = calendarPartsFromTimestamp(now);

  if (!parts) {
    return now.toISOString().slice(0, 10);
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
};
