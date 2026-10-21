/**
 * Seniority (antigüedad) from the original hire date (WRK-I5-5): whole years
 * and months up to a date, in Spanish. Pure, on ISO dates (yyyy-mm-dd).
 */
export const seniorityParts = (fechaIngreso: string, asOf: string) => {
  const [fromYear, fromMonth, fromDay] = fechaIngreso.split("-").map(Number);
  const [toYear, toMonth, toDay] = asOf.split("-").map(Number);
  let months = (toYear - fromYear) * 12 + (toMonth - fromMonth);

  if (toDay < fromDay) {
    months -= 1;
  }

  if (months < 0) {
    return null;
  }

  return { years: Math.floor(months / 12), months: months % 12 };
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** «3 años, 2 meses», «1 año», «5 meses», «menos de un mes»; null before the hire date or without one. */
export const formatSeniority = (
  fechaIngreso: string | null | undefined,
  asOf: string,
) => {
  if (!fechaIngreso) return null;

  const parts = seniorityParts(fechaIngreso, asOf);

  if (!parts) return null;

  const pieces = [
    parts.years > 0 ? plural(parts.years, "año", "años") : null,
    parts.months > 0 ? plural(parts.months, "mes", "meses") : null,
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join(", ") : "menos de un mes";
};

/** What seniorityDate() reads of an employment period. */
export type SeniorityPeriod = {
  fechaIngreso: string | null;
  /** «Reconocer antigüedad previa» chosen on the rehire that opened it. */
  reconoceAntiguedad: boolean;
  fechaAntiguedadReconocida?: string | null;
};

/**
 * The one date seniority counts from (Iniciativa 2), for the constancia, the
 * `antiguedad` contract token, the KPIs, filters and the export. Periods in
 * any order; the latest by ingreso is the current (or last) one.
 *
 * - Without «Reconocer antigüedad previa» (the default) it restarts at the
 *   period's ingreso.
 * - With it, the explicit recognized date if HR gave one, else it carries
 *   over from the previous period's own seniority date: the first period's
 *   ingreso when every rehire recognized it.
 *
 * Without periods (data before the backfill) it is the person's fecha_ingreso.
 */
export const seniorityDate = (
  periods: ReadonlyArray<SeniorityPeriod>,
  fallbackFechaIngreso: string | null = null,
): string | null => {
  const ordered = [...periods].sort((a, b) =>
    (a.fechaIngreso ?? "").localeCompare(b.fechaIngreso ?? ""),
  );
  let date: string | null = null;

  for (const [index, period] of ordered.entries()) {
    if (period.reconoceAntiguedad && period.fechaAntiguedadReconocida) {
      date = period.fechaAntiguedadReconocida;
    } else if (index === 0 || !period.reconoceAntiguedad) {
      date = period.fechaIngreso;
    } else {
      date = date ?? period.fechaIngreso;
    }
  }

  return ordered.length > 0 ? date : fallbackFechaIngreso;
};
