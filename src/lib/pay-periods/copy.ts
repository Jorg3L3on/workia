/** Words of the Periodos de pago screens (W2-15). No database access here. */

export type PayPeriodActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export const INCIDENCIA_KIND_LABELS: Record<string, string> = {
  falta: "Faltas",
  retardo: "Retardos",
  salida_anticipada: "Salidas anticipadas",
};

/** The kinds in the order the screens show them; unknown kinds go after. */
export const INCIDENCIA_KIND_ORDER = ["falta", "retardo", "salida_anticipada"];

export const incidenciaKindLabel = (kind: string) =>
  INCIDENCIA_KIND_LABELS[kind] ?? kind.replaceAll("_", " ");

export const orderedKinds = (kinds: Iterable<string>) => {
  const all = new Set(kinds);
  const known = INCIDENCIA_KIND_ORDER.filter((kind) => all.has(kind));
  const rest = [...all]
    .filter((kind) => !INCIDENCIA_KIND_ORDER.includes(kind))
    .sort();

  return [...known, ...rest];
};

export const PAY_PERIOD_COPY = {
  title: "Periodos de pago",
  description:
    "Al cerrar una quincena se congelan sus incidencias para la pre-nómina; para cambiarlas hay que reabrirla con un motivo.",
  open: "Abierta",
  closed: "Cerrada",
  current: "En curso",
  neverClosed: "Sin cerrar",
  live: "Así quedaría el cierre si se hiciera ahora, con las incidencias registradas hasta este momento.",
  frozen: "Incidencias congeladas en el cierre. Son las que lee la pre-nómina.",
  empty: "No hay incidencias registradas en esta quincena.",
  matches: "El cierre coincide con las incidencias registradas.",
  differs: (count: number) =>
    count === 1
      ? "1 incidencia cambió después del cierre. La pre-nómina sigue leyendo lo congelado; reabre la quincena para tomarla en cuenta."
      : `${count} incidencias cambiaron después del cierre. La pre-nómina sigue leyendo lo congelado; reabre la quincena para tomarlas en cuenta.`,
  closeButton: "Cerrar quincena",
  closeConfirmTitle: "¿Cerrar la quincena?",
  closeConfirm:
    "Se congelan las incidencias registradas hasta ahora y quedan en la bitácora. Una incidencia que llegue después no cambia el cierre hasta que la reabras.",
  reopenButton: "Reabrir",
  reopenTitle: "Reabrir la quincena",
  reopenDescription:
    "Se borra lo congelado y la quincena vuelve a recibir incidencias. El motivo queda en la bitácora. El siguiente cierre será una revisión nueva.",
  reasonLabel: "Motivo",
  closedMessage: (revision: number, rows: number) =>
    `Quincena cerrada (revisión ${revision}, ${rows} ${rows === 1 ? "fila" : "filas"} de incidencias).`,
  reopened: "Quincena reabierta.",
  denied: "Tu rol no permite cerrar ni reabrir quincenas.",
  invalidPeriod: "Periodo inválido.",
  notStarted: "Esa quincena aún no empieza.",
  morePeriods: "Quincenas anteriores",
  morePeople: "Más personas",
} as const;
