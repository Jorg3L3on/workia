import type { IncidenciaJustificationKind } from "@/lib/db/schema/incidencias";

import { quincenaLabel } from "@/lib/pay-periods/quincena";

/** Spanish copy of the incidencias screens and actions (W2-14). */
export const INCIDENCIAS_COPY = {
  rulesTitle: "Reglas de incidencias",
  rulesDescription:
    "Cómo se convierten las checadas y el horario en faltas, retardos y salidas anticipadas. Un cambio aplica desde la siguiente quincena; la que corre conserva sus reglas.",
  retardoLabel: "Tolerancia de entrada (minutos)",
  retardoHint: "Llegar hasta estos minutos tarde no es retardo.",
  salidaLabel: "Tolerancia de salida (minutos)",
  salidaHint: "Salir hasta estos minutos antes no es salida anticipada.",
  faltaAfterLabel: "Retardo que cuenta como falta (minutos)",
  faltaAfterHint:
    "Llegar más tarde que esto cuenta como falta. Déjalo vacío para no aplicarlo.",
  saveRules: "Guardar reglas",
  rulesSaved: (period: string) =>
    `Reglas guardadas. Aplican desde la ${quincenaLabel(period)}.`,
  rulesInEffect: (period: string | null) =>
    period
      ? `En vigor desde la ${quincenaLabel(period)}`
      : "En vigor: valores predeterminados",
  history: "Cambios",
  noHistory: "Todavía no hay cambios: aplican los valores predeterminados.",
  recompute: "Recalcular incidencias",
  recomputing: "Recalculando…",
  recomputed: (count: number) =>
    `Incidencias recalculadas: ${count.toLocaleString("es-MX")}.`,
  denied: "No tienes permiso para cambiar incidencias.",
  invalidPeriod: "Periodo inválido.",
  invalidKind: "Elige un tipo válido.",
  justificationSaved: "Justificación registrada.",
  justified: "Incidencia justificada.",
  voided: "Incidencia anulada.",
  cancelled: "Justificación cancelada.",
  justificationsTitle: "Permisos, incapacidades y decisiones",
  noJustifications: "Sin justificaciones en esta quincena.",
  addJustification: "Registrar permiso o incapacidad",
  incidenciasTitle: "Incidencias de la quincena",
  noIncidencias: "Sin incidencias en esta quincena.",
  justify: "Justificar",
  void: "Anular",
  cancel: "Cancelar justificación",
  reasonLabel: "Motivo",
  referenceLabel: "Folio o referencia (opcional)",
  fromLabel: "Desde",
  toLabel: "Hasta",
  kindLabel: "Tipo",
  closedNote:
    "La quincena está cerrada: para cambiar sus incidencias hay que reabrirla.",
} as const;

export const justificationKindLabel: Record<
  IncidenciaJustificationKind,
  string
> = {
  permiso_con_goce: "Permiso con goce",
  permiso_sin_goce: "Permiso sin goce",
  incapacidad_imss: "Incapacidad IMSS",
  override: "Decisión de RH",
};

/** «Vacaciones», «Incapacidad IMSS», «Decisión de RH» from a justification_ref. */
export const justificationRefLabel = (ref: string | null) => {
  if (!ref) return null;

  const kind = ref.split(":")[0];

  if (kind === "vacation") return "Vacaciones";

  return (
    justificationKindLabel[kind as IncidenciaJustificationKind] ?? "Justificada"
  );
};
