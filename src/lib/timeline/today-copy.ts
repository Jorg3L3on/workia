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

/**
 * A source without a device name: "app" → "Checado en la app", "import" →
 * "Importación", "checador:<x>" → "Checador <x>". The today view names
 * W2-12 checadores by their device name instead.
 */
export const sourceLabel = (source: string) => {
  if (source === "import") return "Importación";
  if (source === "app") return "Checado en la app";
  if (source === "backfill") return "Carga inicial";
  if (source === "checador") return "Checador";
  if (source.startsWith("checador:")) {
    const device = source.slice("checador:".length);
    // A W2-12 checador id says nothing to a person.
    return /^[0-9a-f-]{36}$/i.test(device) ? "Checador" : `Checador ${device}`;
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
