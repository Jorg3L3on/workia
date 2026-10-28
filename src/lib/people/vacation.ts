import {
  seniorityDate as resolveSeniorityDate,
  seniorityParts,
} from "@/lib/people/seniority";

/**
 * Vacation entitlement (WRK-I14-1). Pure: ISO dates in, no clock, no I/O.
 *
 * Days follow the Ley Federal del Trabajo as reformed by the decree published
 * in the Diario Oficial de la Federación on 27 December 2022 (articles 76 and
 * 78). Article 76 grants 12 working days after the first service year, then
 * two more each year through the fifth (14, 16, 18, 20). From the sixth year
 * it adds two days for every five years of service. The block reading — 22
 * (years 6–10), 24 (11–15), 26 (16–20), 28 (21–25), 30 (26–30), and the same
 * step after year 30 — is pending confirmation by an accountant.
 *
 * Article 78 requires at least twelve of those days to be continuous; this
 * module only counts them. Article 81: grant the vacation within six months
 * after the service year is completed (`grantBy`). Less than one year sets
 * `proportionalOnly` and zero days (no full entitlement yet).
 *
 * Completed years come only from `seniorityDate` / `seniorityParts`. The
 * accrual basis is explicit and defaults to `anniversary` (article 81).
 */

/** Days for service years 1–5 (article 76). */
const ENTITLEMENT_FIRST_FIVE_YEARS = [12, 14, 16, 18, 20] as const;

/** Article 81: six months after the anniversary that completed the year. */
const GRANT_WITHIN_MONTHS = 6;

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How the vacation year is counted. Only `anniversary` is defined; a
 * calendar-year policy can be added later without changing the default.
 */
export type VacationAccrualBasis = "anniversary";

export type VacationPeriod = {
  serviceYearsCompleted: number;
  /**
   * Anniversary that opened this service year. The seniority date itself when
   * no year is complete yet.
   */
  currentAnniversary: string;
  nextAnniversary: string;
  entitlementDays: number;
  /**
   * Six months after `currentAnniversary` (article 81). There is nothing to
   * grant yet when `proportionalOnly` is true.
   */
  grantBy: string;
  /** True when less than one year of service is complete. */
  proportionalOnly: boolean;
};

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number) =>
  month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month];

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatIsoDate = (year: number, month: number, day: number) =>
  `${year}-${pad2(month)}-${pad2(day)}`;

const parseIsoDate = (value: string) => {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
};

/**
 * Anniversary `years` after the seniority date. 29 February in a non-leap
 * year falls on 1 March: the first day `seniorityParts` counts that year
 * complete.
 */
const shiftYears = (iso: string, years: number) => {
  const parsed = parseIsoDate(iso);

  if (!parsed) {
    return null;
  }

  const year = parsed.year + years;

  if (parsed.day <= daysInMonth(year, parsed.month)) {
    return formatIsoDate(year, parsed.month, parsed.day);
  }

  if (parsed.month === 2 && parsed.day === 29) {
    return formatIsoDate(year, 3, 1);
  }

  return null;
};

const addMonths = (iso: string, monthsToAdd: number) => {
  const parsed = parseIsoDate(iso);

  if (!parsed || monthsToAdd < 0) {
    return null;
  }

  const monthIndex = parsed.month - 1 + monthsToAdd;
  const year = parsed.year + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));

  return formatIsoDate(year, month, day);
};

/**
 * Working days the statute assigns to a completed service year.
 * Year 6 and later use the five-year blocks above; that reading is pending
 * confirmation by an accountant.
 */
export const entitlementDaysForServiceYear = (serviceYear: number) => {
  if (!Number.isInteger(serviceYear) || serviceYear < 1) {
    return 0;
  }

  if (serviceYear <= ENTITLEMENT_FIRST_FIVE_YEARS.length) {
    return ENTITLEMENT_FIRST_FIVE_YEARS[serviceYear - 1];
  }

  const blocksAfterFifth = Math.ceil((serviceYear - 5) / 5);

  return 20 + blocksAfterFifth * 2;
};

const periodOnAnniversary = (
  seniority: string,
  asOf: string,
): VacationPeriod | null => {
  if (!parseIsoDate(seniority) || !parseIsoDate(asOf)) {
    return null;
  }

  const parts = seniorityParts(seniority, asOf);

  if (!parts) {
    return null;
  }

  const currentAnniversary = shiftYears(seniority, parts.years);
  const nextAnniversary = shiftYears(seniority, parts.years + 1);
  const grantBy = currentAnniversary
    ? addMonths(currentAnniversary, GRANT_WITHIN_MONTHS)
    : null;

  if (!currentAnniversary || !nextAnniversary || !grantBy) {
    return null;
  }

  return {
    serviceYearsCompleted: parts.years,
    currentAnniversary,
    nextAnniversary,
    entitlementDays: entitlementDaysForServiceYear(parts.years),
    grantBy,
    proportionalOnly: parts.years < 1,
  };
};

const PERIOD_FOR_BASIS: Record<
  VacationAccrualBasis,
  (seniority: string, asOf: string) => VacationPeriod | null
> = {
  anniversary: periodOnAnniversary,
};

/**
 * Entitlement for the service year that contains `asOf`. `seniorityDate` is
 * the date `seniorityDate()` already resolved (ISO `yyyy-mm-dd`). `asOf` is
 * an ISO date too: pass it in; this function does not read the clock.
 * Null without a seniority date, with a date that is not a calendar day, or
 * when `asOf` is before the seniority date.
 */
export const vacationPeriodFor = (
  seniorityDate: string | null | undefined,
  asOf: string,
  accrualBasis: VacationAccrualBasis = "anniversary",
): VacationPeriod | null => {
  const resolved = resolveSeniorityDate([], seniorityDate ?? null);

  if (!resolved) {
    return null;
  }

  return PERIOD_FOR_BASIS[accrualBasis](resolved, asOf);
};
