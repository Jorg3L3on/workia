import { seniorityDate } from "@/lib/people/seniority";
import {
  entitlementDaysForServiceYear,
  vacationPeriodFor,
} from "@/lib/people/vacation";

import type { VacationPeriodSlice, VacationSpan } from "./types";

/**
 * Days-taken rules for the ledger (WRK-I14-3). Each line below is a choice
 * waiting on an accountant; the product uses the safest simple default and
 * does not offer the other reading.
 *
 * pendiente de contador: days taken are the number the user types. The
 * calendar dates are only the range used for overlap and for the history.
 * pendiente de contador: half days are allowed in 0.5 steps.
 * pendiente de contador: the service year follows the anniversary of
 * seniority. A calendar-year split is not offered.
 * pendiente de contador: the rest day from the schedule is not subtracted.
 * That reading stays off.
 * pendiente de contador: there is no pay-instead-of-resting option (Art. 79
 * LFT). Nothing in this module records money for vacation days.
 */

export const VACATION_OVER_ENTITLEMENT_WARNING =
  "Supera los días de derecho de este año de servicio. Se puede guardar.";

export const VACATION_COPY = {
  days: "Indica los días en medios días, mayores a 0 (por ejemplo 1 o 0.5).",
  endBeforeStart: "La fecha de fin no puede ser anterior al inicio.",
  startDate: "Indica la fecha de inicio.",
  endDate: "Indica la fecha de fin.",
  noServiceYear: "No se puede ubicar el año de servicio para esa fecha.",
  overlap: "Esas fechas se cruzan con vacaciones ya registradas.",
  notFound: "No encontramos ese registro en esta empresa.",
  personNotFound: "No encontramos a esa persona en esta empresa.",
  alreadyVoided: "Ese registro ya está anulado.",
  deniedCreate: "No tienes permiso para registrar vacaciones.",
  deniedVoid: "No tienes permiso para anular vacaciones.",
  note: "La nota puede tener hasta 280 caracteres.",
  emptyHistory: "Sin vacaciones registradas.",
  over: VACATION_OVER_ENTITLEMENT_WARNING,
} as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_PATTERN = /^(\d{1,3})(?:\.(\d)0*)?$/;
const NOTE_LIMIT = 280;

const isIsoDate = (value: string) => {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
};

/**
 * Half-day units (2 = one day) so 0.5 steps add without float drift.
 * Null when the value is empty, zero, above 999.5, or not a 0.5 step.
 */
export const toHalfUnits = (value: string | number): number | null => {
  const text = String(value).trim().replace(",", ".");
  const match = DAYS_PATTERN.exec(text);

  if (!match) {
    return null;
  }

  const whole = Number(match[1]);
  const tenth = match[2] ? Number(match[2]) : 0;

  if (tenth !== 0 && tenth !== 5) {
    return null;
  }

  const halves = whole * 2 + (tenth === 5 ? 1 : 0);

  if (halves <= 0 || halves > 999 * 2 + 1) {
    return null;
  }

  return halves;
};

/** Canonical numeric(4,1) text: "5.0", "0.5". */
export const formatStoredDays = (halves: number) => {
  const whole = Math.floor(Math.abs(halves) / 2);
  const tenth = Math.abs(halves) % 2 === 1 ? "5" : "0";

  return `${whole}.${tenth}`;
};

const dayWord = (absHalves: number) => (absHalves === 2 ? "día" : "días");

/** Whole numbers stay plain; a half day uses a comma («0,5», «1,5»). */
const dayNumber = (absHalves: number) => {
  const whole = Math.floor(absHalves / 2);

  if (absHalves % 2 === 0) {
    return String(whole);
  }

  return `${whole},5`;
};

/** "5 días", "1 día", "0,5 días". */
export const formatVacationDays = (value: string | number) => {
  const halves = toHalfUnits(value);

  if (halves === null) {
    return String(value);
  }

  return `${dayNumber(halves)} ${dayWord(halves)}`;
};

/** Same as formatVacationDays, keeping a leading minus when the balance is short. */
export const formatSignedVacationDays = (halves: number) => {
  const abs = Math.abs(halves);
  const sign = halves < 0 ? "−" : "";

  return `${sign}${dayNumber(abs)} ${dayWord(abs)}`;
};

export type ServiceYearBalance = {
  serviceYear: number;
  entitlementDays: number;
  takenHalves: number;
  remainingHalves: number;
  exceedsEntitlement: boolean;
};

/** Entitlement minus the non-voided days of that service year. */
export const serviceYearBalance = ({
  serviceYear,
  entitlementDays,
  entries,
}: {
  serviceYear: number;
  entitlementDays: number;
  entries: Pick<VacationSpan, "serviceYear" | "days" | "voided">[];
}): ServiceYearBalance => {
  const takenHalves = entries.reduce((sum, entry) => {
    if (entry.voided || entry.serviceYear !== serviceYear) {
      return sum;
    }

    return sum + (toHalfUnits(entry.days) ?? 0);
  }, 0);
  const entitlementHalves = Math.round(entitlementDays * 2);

  return {
    serviceYear,
    entitlementDays,
    takenHalves,
    remainingHalves: entitlementHalves - takenHalves,
    exceedsEntitlement: takenHalves > entitlementHalves,
  };
};

const rangesOverlap = (
  left: { startDate: string; endDate: string },
  right: { startDate: string; endDate: string },
) => left.startDate <= right.endDate && right.startDate <= left.endDate;

const periodContaining = (periods: VacationPeriodSlice[], startDate: string) =>
  periods
    .filter((period) => {
      if (!period.fechaIngreso || period.bajaSinFecha) {
        return false;
      }

      if (startDate < period.fechaIngreso) {
        return false;
      }

      if (period.fechaBaja && startDate > period.fechaBaja) {
        return false;
      }

      return true;
    })
    .sort((left, right) =>
      (right.fechaIngreso ?? "").localeCompare(left.fechaIngreso ?? ""),
    )[0] ?? null;

const cleanNote = (
  note: string | null | undefined,
): { ok: true; note: string | null } | { ok: false; error: string } => {
  const trimmed = note?.trim() ?? "";

  if (trimmed.length > NOTE_LIMIT) {
    return { ok: false, error: VACATION_COPY.note };
  }

  return { ok: true, note: trimmed.length > 0 ? trimmed : null };
};

export type VacationPreview =
  | {
      ok: true;
      serviceYear: number;
      days: string;
      note: string | null;
      periodId: string | null;
      warning: string | null;
    }
  | { ok: false; error: string };

/**
 * Validates a registration and places it in a service year. Pure: the
 * caller passes the person's periods and the ranges already stored.
 */
export const previewVacationRegistration = ({
  periods,
  fallbackFechaIngreso,
  startDate,
  endDate,
  days,
  note,
  existing,
}: {
  periods: VacationPeriodSlice[];
  fallbackFechaIngreso: string | null;
  startDate: string;
  endDate: string;
  days: string;
  note?: string | null;
  existing: VacationSpan[];
}): VacationPreview => {
  if (!isIsoDate(startDate)) {
    return { ok: false, error: VACATION_COPY.startDate };
  }

  if (!isIsoDate(endDate)) {
    return { ok: false, error: VACATION_COPY.endDate };
  }

  if (endDate < startDate) {
    return { ok: false, error: VACATION_COPY.endBeforeStart };
  }

  const halves = toHalfUnits(days);

  if (halves === null) {
    return { ok: false, error: VACATION_COPY.days };
  }

  const noted = cleanNote(note);

  if (!noted.ok) {
    return noted;
  }

  // pendiente de contador: anniversary of the seniority date that applied
  // on the start day (periods that had already started). Not the calendar year.
  const seniority = seniorityDate(
    periods.filter(
      (period) => period.fechaIngreso && period.fechaIngreso <= startDate,
    ),
    fallbackFechaIngreso,
  );
  const vacation = vacationPeriodFor(seniority, startDate);

  if (!vacation) {
    return { ok: false, error: VACATION_COPY.noServiceYear };
  }

  const overlaps = existing.some(
    (row) =>
      !row.voided &&
      rangesOverlap(
        { startDate, endDate },
        { startDate: row.startDate, endDate: row.endDate },
      ),
  );

  if (overlaps) {
    return { ok: false, error: VACATION_COPY.overlap };
  }

  const entitlementDays = entitlementDaysForServiceYear(
    vacation.serviceYearsCompleted,
  );
  const takenHalves = serviceYearBalance({
    serviceYear: vacation.serviceYearsCompleted,
    entitlementDays,
    entries: existing,
  }).takenHalves;
  const exceeds = takenHalves + halves > Math.round(entitlementDays * 2);

  return {
    ok: true,
    serviceYear: vacation.serviceYearsCompleted,
    days: formatStoredDays(halves),
    note: noted.note,
    periodId: periodContaining(periods, startDate)?.id ?? null,
    warning: exceeds ? VACATION_OVER_ENTITLEMENT_WARNING : null,
  };
};
