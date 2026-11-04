import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format/date";
import type { Tone } from "@/lib/ui/status-tone";

import type { TodayStatus } from "./today-status";

/** Labels of the today screen (W2-17). */
export const TODAY_STATUS: Record<TodayStatus, { label: string; tone: Tone }> =
  {
    on_shift: { label: "En turno", tone: "success" },
    left: { label: "Salió", tone: "neutral" },
    absent: { label: "Falta", tone: "danger" },
    pending: { label: "Sin registro", tone: "info" },
  };

export const TODAY_INCIDENCIA_LABEL: Record<string, string> = {
  falta: "Falta",
  retardo: "Retardo",
  salida_anticipada: "Salida anticipada",
};

/** "checador:<device>" → "Checador <device>"; "import" → "Importación". */
export const sourceLabel = (source: string) => {
  if (source === "import") return "Importación";
  if (source === "backfill") return "Carga inicial";
  if (source === "checador") return "Checador";
  if (source.startsWith("checador:")) {
    return `Checador ${source.slice("checador:".length)}`;
  }
  return source;
};

/** An instant as 24 h local time in Mexico City (08:05), or — when missing. */
export const formatClockMx = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};
