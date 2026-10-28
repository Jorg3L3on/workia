import { vacationPeriodForCompletedYear } from "@/lib/people/vacation";

import { serviceYearBalance } from "./balance";
import type { VacationSpan } from "./types";

/**
 * Figures for one printed vacation constancia (WRK-I14-4). Pure: no clock,
 * no database. Days taken are the non-voided rows of that service year.
 * Ledger notes are left out: they are free text and could carry health data.
 * There is no pay-instead-of-resting option.
 *
 * pendiente de contador: the grant-by date is the engine's six-month reading
 * (Art. 81). Callers show the date and do not restate the article.
 * pendiente de contador: days for service years 6 and later are the engine's
 * five-year blocks. Callers show that number and do not restate the rule.
 * pendiente de contador: no Art. 81 sentence belongs on the sheet. That
 * wording stays off until an accountant confirms it.
 */

export type VacationConstanciaRange = {
  startDate: string;
  endDate: string;
  days: string;
};

export type VacationConstancia = {
  companyName: string;
  personName: string;
  seniorityDate: string;
  serviceYear: number;
  entitlementDays: number;
  takenHalves: number;
  grantBy: string;
  issuedOn: string;
  /** Non-voided ranges of this service year, oldest start first. */
  ranges: VacationConstanciaRange[];
};

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

/**
 * Builds the sheet for one completed service year. Null when that year is
 * not complete by `asOf`, or when the engine has no period for it.
 * `entries` may include other years and voided rows; only non-voided rows
 * of `serviceYear` count.
 */
export const composeVacationConstancia = ({
  companyName,
  personName,
  seniorityDate,
  serviceYear,
  asOf,
  entries,
}: {
  companyName: string;
  personName: string;
  seniorityDate: string;
  serviceYear: number;
  asOf: string;
  entries: VacationSpan[];
}): VacationConstancia | null => {
  const period = vacationPeriodForCompletedYear(seniorityDate, serviceYear);

  if (!period || asOf < period.currentAnniversary) {
    return null;
  }

  const balance = serviceYearBalance({
    serviceYear,
    entitlementDays: period.entitlementDays,
    entries,
  });
  const ranges = entries
    .filter((entry) => !entry.voided && entry.serviceYear === serviceYear)
    .slice()
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.endDate.localeCompare(right.endDate),
    )
    .map((entry) => ({
      startDate: entry.startDate,
      endDate: entry.endDate,
      days: String(entry.days),
    }));

  return {
    companyName: blank(companyName) ?? "La empresa",
    personName,
    seniorityDate,
    serviceYear,
    entitlementDays: period.entitlementDays,
    takenHalves: balance.takenHalves,
    grantBy: period.grantBy,
    issuedOn: asOf,
    ranges,
  };
};
