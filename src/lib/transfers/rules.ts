import { isValidCurp, normalizeCurp } from "@/lib/people/identity";

/**
 * Transfers between subsidiaries (W2-24): the pure rules and the words HR
 * sees. Client-safe: the transfer form imports it.
 */

export const TRANSFER_COPY = {
  title: "Trasladar a otra empresa del grupo",
  denied: "No tienes permiso para trasladar personas entre estas empresas.",
  sameCompany: "Elige la empresa a la que se traslada.",
  dateRequired: "La fecha de traslado es obligatoria.",
  targetNotFound: "Esa empresa no existe o está suspendida.",
  notActive: "Solo se traslada a una persona activa.",
  curpMissing:
    "Para trasladar a esta persona primero captura su CURP en el expediente.",
  curpMismatch:
    "La CURP de los dos expedientes no coincide: no es la misma persona. Corrige la CURP antes de trasladar.",
  noOpenPeriod: "La persona no tiene un periodo laboral abierto.",
  afterIngreso: "El traslado debe ser posterior al ingreso",
  afterTargetBaja:
    "El traslado debe ser posterior a su baja anterior en esa empresa",
  alreadyActive: "ya trabaja en",
  identityTaken: "Otra persona usa ya estos datos en",
  dimensionNotFound: "Elige un registro vigente de la empresa de destino.",
  targetRowNotFound: "Ese expediente no existe en la empresa de destino.",
  done: "Traslado registrado.",
} as const;

/**
 * The two rows are the same person: both carry the same valid CURP, once
 * normalized. A blank or invalid CURP never matches.
 */
export const curpsMatch = (
  left: string | null | undefined,
  right: string | null | undefined,
) => {
  const a = normalizeCurp(left);
  const b = normalizeCurp(right);

  return isValidCurp(a) && a === b;
};

/** The calendar day before an ISO date (yyyy-mm-dd). */
export const dayBefore = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, date - 1))
    .toISOString()
    .slice(0, 10);
};
