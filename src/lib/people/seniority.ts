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
