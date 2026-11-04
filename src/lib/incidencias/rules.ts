import { quincenaOf } from "@/lib/pay-periods/quincena";

/**
 * The rules the incidencias engine applies (W2-14). Each company sets them;
 * a change starts in the next quincena, so a running period keeps the rules
 * it started with. Pure: no database access here.
 */
export type IncidenciaRules = {
  /** Minutes after the entry time that are not a retardo yet. */
  retardoToleranceMinutes: number;
  /** Minutes before the exit time that are not a salida anticipada yet. */
  salidaToleranceMinutes: number;
  /** A late arrival of more than this is a falta instead of a retardo; null: never. */
  faltaAfterMinutes: number | null;
};

export const DEFAULT_INCIDENCIA_RULES: IncidenciaRules = {
  retardoToleranceMinutes: 10,
  salidaToleranceMinutes: 0,
  faltaAfterMinutes: null,
};

export const MAX_TOLERANCE_MINUTES = 120;
export const MAX_FALTA_AFTER_MINUTES = 720;

/** Why the rules cannot be saved, or null when they can. */
export const rulesProblem = (rules: IncidenciaRules): string | null => {
  const whole = (value: number) => Number.isInteger(value) && value >= 0;

  if (
    !whole(rules.retardoToleranceMinutes) ||
    rules.retardoToleranceMinutes > MAX_TOLERANCE_MINUTES
  ) {
    return `La tolerancia de entrada va de 0 a ${MAX_TOLERANCE_MINUTES} minutos.`;
  }

  if (
    !whole(rules.salidaToleranceMinutes) ||
    rules.salidaToleranceMinutes > MAX_TOLERANCE_MINUTES
  ) {
    return `La tolerancia de salida va de 0 a ${MAX_TOLERANCE_MINUTES} minutos.`;
  }

  if (
    rules.faltaAfterMinutes !== null &&
    (!whole(rules.faltaAfterMinutes) ||
      rules.faltaAfterMinutes <= rules.retardoToleranceMinutes ||
      rules.faltaAfterMinutes > MAX_FALTA_AFTER_MINUTES)
  ) {
    return `El retardo que cuenta como falta debe ser mayor que la tolerancia y de hasta ${MAX_FALTA_AFTER_MINUTES} minutos.`;
  }

  return null;
};

/** The quincena after this one: 2026-11-Q2 → 2026-12-Q1. */
export const nextQuincena = (period: string) => {
  const [year, month, half] = [
    Number(period.slice(0, 4)),
    Number(period.slice(5, 7)),
    period.slice(9),
  ];

  if (half === "1") return `${period.slice(0, 7)}-Q2`;

  return month === 12
    ? `${year + 1}-01-Q1`
    : `${year}-${String(month + 1).padStart(2, "0")}-Q1`;
};

/** The first quincena a change saved on `today` applies to. */
export const firstPeriodForChange = (today: string) =>
  nextQuincena(quincenaOf(today));

/**
 * The rules of `period` from a company's history (any order): the row with
 * the latest effective period up to it, or the defaults.
 */
export const rulesForPeriod = (
  history: Array<IncidenciaRules & { effectivePeriod: string }>,
  period: string,
): IncidenciaRules & { effectivePeriod: string | null } => {
  const row = history
    .filter((entry) => entry.effectivePeriod <= period)
    .sort((a, b) => b.effectivePeriod.localeCompare(a.effectivePeriod))[0];

  return row
    ? {
        retardoToleranceMinutes: row.retardoToleranceMinutes,
        salidaToleranceMinutes: row.salidaToleranceMinutes,
        faltaAfterMinutes: row.faltaAfterMinutes,
        effectivePeriod: row.effectivePeriod,
      }
    : { ...DEFAULT_INCIDENCIA_RULES, effectivePeriod: null };
};
