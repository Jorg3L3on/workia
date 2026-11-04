import { vacationPeriodForCompletedYear } from "@/lib/people/vacation";
import {
  vacationEntitlementForPerson,
  type VacationEntitlementView,
} from "@/lib/people/vacation-card";

import {
  serviceYearBalance,
  toHalfUnits,
  type ServiceYearBalance,
} from "./balance";

/**
 * One person's vacation balance, the same object for the HR card and the
 * employee view (Workia 2.0, W2-05). Pure: no clock, no database.
 *
 * Days only. Nothing here is money: no prima vacacional, no pay-out, no
 * amount (the payroll provider pays prima vacacional). The balance is always
 * computed from the ledger rows; there is no stored balance.
 *
 * pendiente de contador: past service years show their own entitlement minus
 * the days placed in them. Expiry of unused days (Art. 516 LFT) is not
 * applied; that reading stays off until an accountant confirms it.
 */

/** A ledger row as the employee sees it. No note, no author: free text could carry health data. */
export type VacationBalanceRecord = {
  id: string;
  startDate: string;
  endDate: string;
  days: string;
  serviceYear: number;
};

export type VacationYearLine = {
  serviceYear: number;
  /** Anniversary that completed this service year. Null when the engine has no period for it. */
  anniversary: string | null;
  /** Six months after the anniversary (Art. 81). Null without a period. */
  grantBy: string | null;
  /** Null when the reformed table did not apply that year, or for year 0. */
  entitlementDays: number | null;
  takenHalves: number;
  /** Null when there is no entitlement to subtract from. */
  remainingHalves: number | null;
  exceedsEntitlement: boolean;
  /** The service year the HR card shows. */
  current: boolean;
  /** A printable constancia exists for this year (getVacationConstancia answers it). */
  constancia: boolean;
};

export type VacationBalanceSummary = {
  /** The entitlement card (state, anniversaries, days of right). */
  view: VacationEntitlementView;
  /** The balance the HR card shows: current service year. Null without an entitlement. */
  current: ServiceYearBalance | null;
  /** Newest service year first. */
  years: VacationYearLine[];
  /** Non-voided ranges, newest start first. */
  records: VacationBalanceRecord[];
};

type RecordInput = {
  id: string;
  startDate: string;
  endDate: string;
  days: string;
  serviceYear: number;
};

const takenIn = (records: RecordInput[], serviceYear: number) =>
  records.reduce(
    (sum, record) =>
      record.serviceYear === serviceYear
        ? sum + (toHalfUnits(record.days) ?? 0)
        : sum,
    0,
  );

/**
 * `records` are the non-voided rows (`listVacationRecords`). The other
 * inputs are the ones the expediente already uses for the entitlement card:
 * the seniority date of the periods (or people.fecha_ingreso), the status,
 * the fecha de baja and today.
 */
export const composeVacationBalance = ({
  seniorityDate,
  status,
  fechaBaja,
  today,
  records,
}: {
  seniorityDate: string | null;
  status: "activa" | "baja";
  fechaBaja: string | null;
  today: string;
  records: RecordInput[];
}): VacationBalanceSummary => {
  const view = vacationEntitlementForPerson({
    seniorityDate,
    status,
    fechaBaja,
    today,
  });
  const entries = records.map((record) => ({
    serviceYear: record.serviceYear,
    days: record.days,
    voided: false,
  }));
  const current =
    view.serviceYearsCompleted !== null && view.entitlementDays !== null
      ? serviceYearBalance({
          serviceYear: view.serviceYearsCompleted,
          entitlementDays: view.entitlementDays,
          entries,
        })
      : null;

  const completed =
    view.entitlementDays !== null && view.serviceYearsCompleted !== null
      ? view.serviceYearsCompleted
      : 0;
  const yearsWithRecords = new Set(records.map((record) => record.serviceYear));
  const lines: VacationYearLine[] = [];

  if (current && view.serviceYearsCompleted !== null) {
    lines.push({
      serviceYear: current.serviceYear,
      anniversary: view.currentAnniversary,
      grantBy: view.grantBy,
      entitlementDays: current.entitlementDays,
      takenHalves: current.takenHalves,
      remainingHalves: current.remainingHalves,
      exceedsEntitlement: current.exceedsEntitlement,
      current: true,
      constancia:
        Boolean(seniorityDate) &&
        vacationPeriodForCompletedYear(seniorityDate, current.serviceYear) !==
          null,
    });
  }

  for (let year = completed - 1; year >= 1; year -= 1) {
    const period = seniorityDate
      ? vacationPeriodForCompletedYear(seniorityDate, year)
      : null;

    if (!period && !yearsWithRecords.has(year)) {
      continue;
    }

    const taken = takenIn(records, year);
    const entitlementHalves = period
      ? Math.round(period.entitlementDays * 2)
      : null;

    lines.push({
      serviceYear: year,
      anniversary: period?.currentAnniversary ?? null,
      grantBy: period?.grantBy ?? null,
      entitlementDays: period?.entitlementDays ?? null,
      takenHalves: taken,
      remainingHalves:
        entitlementHalves === null ? null : entitlementHalves - taken,
      exceedsEntitlement:
        entitlementHalves !== null && taken > entitlementHalves,
      current: false,
      constancia: period !== null,
    });
  }

  // Rows placed in a year outside 1..current (year 0, or a cutoff earlier
  // than the row) still count as taken, with no entitlement beside them.
  const listed = new Set(lines.map((line) => line.serviceYear));

  for (const year of [...yearsWithRecords].sort(
    (left, right) => right - left,
  )) {
    if (listed.has(year)) {
      continue;
    }

    lines.push({
      serviceYear: year,
      anniversary: null,
      grantBy: null,
      entitlementDays: null,
      takenHalves: takenIn(records, year),
      remainingHalves: null,
      exceedsEntitlement: false,
      current: false,
      constancia: false,
    });
  }

  lines.sort((left, right) => right.serviceYear - left.serviceYear);

  return {
    view,
    current,
    years: lines,
    records: records
      .map((record) => ({
        id: record.id,
        startDate: record.startDate,
        endDate: record.endDate,
        days: record.days,
        serviceYear: record.serviceYear,
      }))
      .sort(
        (left, right) =>
          right.startDate.localeCompare(left.startDate) ||
          right.endDate.localeCompare(left.endDate),
      ),
  };
};
