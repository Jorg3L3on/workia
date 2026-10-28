import { formatDateMx } from "@/lib/format/date";
import {
  VACATION_TABLE_EFFECTIVE_FROM,
  vacationPeriodFor,
} from "@/lib/people/vacation";

/**
 * Read-only view of `vacationPeriodFor` for the expediente card and the MCP
 * tool `get_vacation_entitlement` (WRK-I14-2). Both show this object. `asOf`
 * is passed in: the server's today, or the fecha de baja when the period is
 * closed. This module does not read the clock.
 *
 * The reformed table applies from `VACATION_TABLE_EFFECTIVE_FROM`
 * (2023-01-01). From year 6 the engine's five-year blocks (22, 24, 26, 28,
 * 30, and +2 every five years after year 30) are pending confirmation by an
 * accountant or a labor lawyer. That caveat stays out of the UI.
 *
 * No days taken, no balance, and no free-text note (a note could carry
 * health data). `grantBy` is omitted when `proportionalOnly` is true: that
 * date is not a real deadline.
 */

export const VACATION_PRIMA_TEXT =
  "Prima vacacional: no menor al 25% (Art. 80 LFT)";

export const VACATION_CARD_COPY = {
  noHireDate: "Sin fecha de ingreso",
  notYet: "Aún no genera vacaciones",
  closed: "Periodo cerrado",
  /** Neutral: the engine returns null before the reformed table is in force. */
  beforeTable: "Sin cálculo para esta fecha",
  error: "No se pudo calcular el derecho a vacaciones",
} as const;

export type VacationEntitlementState =
  | "no_hire_date"
  | "before_table"
  | "proportional"
  | "entitled"
  | "closed"
  | "error";

export type VacationEntitlementView = {
  state: VacationEntitlementState;
  /** Fixed status sentence. Null when the figures are the whole answer. */
  message: string | null;
  serviceYearsCompleted: number | null;
  currentAnniversary: string | null;
  nextAnniversary: string | null;
  /** Null when there is no entitlement yet (`proportionalOnly`). */
  entitlementDays: number | null;
  /** Null when there is no real deadline (`proportionalOnly` or no period). */
  grantBy: string | null;
  /** The Art. 80 line, or null when there is no entitlement to attach it to. */
  prima: typeof VACATION_PRIMA_TEXT | null;
  closed: boolean;
  /** The date the engine was given. Null when a closed period has no date. */
  asOf: string | null;
};

const EMPTY_FIGURES = {
  serviceYearsCompleted: null,
  currentAnniversary: null,
  nextAnniversary: null,
  entitlementDays: null,
  grantBy: null,
  prima: null,
} as const;

const statusLine = (closed: boolean, detail: string | null) => {
  const parts = [closed ? VACATION_CARD_COPY.closed : null, detail].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(" · ") : null;
};

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

const viewOf = (
  state: VacationEntitlementState,
  closed: boolean,
  asOf: string | null,
  detail: string | null,
  figures: Partial<
    Pick<
      VacationEntitlementView,
      | "serviceYearsCompleted"
      | "currentAnniversary"
      | "nextAnniversary"
      | "entitlementDays"
      | "grantBy"
      | "prima"
    >
  > = {},
): VacationEntitlementView => ({
  state,
  message: statusLine(closed, detail),
  ...EMPTY_FIGURES,
  ...figures,
  closed,
  asOf,
});

/**
 * The card (and the tool) for one person. `seniorityDate` is the date
 * `seniorityDate()` already resolved. `closed` is a baja. `asOf` is explicit.
 */
export const vacationEntitlementView = ({
  seniorityDate,
  asOf,
  closed,
}: {
  seniorityDate: string | null;
  asOf: string | null;
  closed: boolean;
}): VacationEntitlementView => {
  const seniority = blank(seniorityDate);
  const on = blank(asOf);

  if (!seniority) {
    return viewOf("no_hire_date", closed, on, VACATION_CARD_COPY.noHireDate);
  }

  // A baja without fecha de baja has no day to count to. Do not use today.
  if (closed && !on) {
    return viewOf("closed", true, null, null);
  }

  if (!on) {
    return viewOf("error", closed, null, VACATION_CARD_COPY.error);
  }

  // Lexicographic order matches chronology for yyyy-mm-dd.
  if (on < VACATION_TABLE_EFFECTIVE_FROM) {
    return viewOf("before_table", closed, on, VACATION_CARD_COPY.beforeTable);
  }

  const period = vacationPeriodFor(seniority, on);

  if (!period) {
    return viewOf("error", closed, on, VACATION_CARD_COPY.error);
  }

  if (period.proportionalOnly) {
    return viewOf("proportional", closed, on, VACATION_CARD_COPY.notYet, {
      serviceYearsCompleted: period.serviceYearsCompleted,
      currentAnniversary: period.currentAnniversary,
      nextAnniversary: period.nextAnniversary,
    });
  }

  return viewOf("entitled", closed, on, null, {
    serviceYearsCompleted: period.serviceYearsCompleted,
    currentAnniversary: period.currentAnniversary,
    nextAnniversary: period.nextAnniversary,
    entitlementDays: period.entitlementDays,
    grantBy: period.grantBy,
    prima: VACATION_PRIMA_TEXT,
  });
};

/**
 * The day seniority (and this card) is counted to. Matches `seniorityAsOf`:
 * today while the person is active; on baja, the fecha de baja, or today
 * when that date is still ahead; null when the baja has no date.
 */
export const vacationAsOf = ({
  status,
  fechaBaja,
  today,
}: {
  status: "activa" | "baja";
  fechaBaja: string | null;
  today: string;
}) => {
  if (status !== "baja") {
    return today;
  }

  if (!fechaBaja) {
    return null;
  }

  return fechaBaja < today ? fechaBaja : today;
};

/**
 * Same inputs as the expediente: seniority date of the periods (or
 * people.fecha_ingreso when there are none), counted to today, or to the
 * fecha de baja when the person is on baja.
 */
export const vacationEntitlementForPerson = ({
  seniorityDate,
  status,
  fechaBaja,
  today,
}: {
  seniorityDate: string | null;
  status: "activa" | "baja";
  fechaBaja: string | null;
  today: string;
}) =>
  vacationEntitlementView({
    seniorityDate,
    asOf: vacationAsOf({ status, fechaBaja, today }),
    closed: status === "baja",
  });

const mx = (value: string | null) => (value ? formatDateMx(value) : null);

/** Snake-case fields the MCP tool returns. The card renders the same view. */
export const vacationToolFields = (view: VacationEntitlementView) => ({
  state: view.state,
  message: view.message,
  service_years_completed: view.serviceYearsCompleted,
  current_anniversary: view.currentAnniversary,
  current_anniversary_mx: mx(view.currentAnniversary),
  next_anniversary: view.nextAnniversary,
  next_anniversary_mx: mx(view.nextAnniversary),
  entitlement_days: view.entitlementDays,
  grant_by: view.grantBy,
  grant_by_mx: mx(view.grantBy),
  prima_vacacional: view.prima,
  closed: view.closed,
  as_of: view.asOf,
  as_of_mx: mx(view.asOf),
});
