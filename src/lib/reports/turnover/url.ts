/**
 * The turnover report's filter in the URL (WRK-I12): one compact, versioned
 * `r` parameter, like Personas' `f` but with its own version so the two
 * never read each other's links.
 *
 *   ?r=r1*desde.2026-01-01*hasta.2026-03-31*area.<id>,<id>*jefe.<id>*equipo.1
 *
 * After the version, `*` separates parts; inside one, `.` separates the key
 * from its values and `,` the values. Unknown versions, keys and invalid
 * values are ignored: a broken link falls back to the default range.
 */

import { addMonths, monthFirstDay, monthKey, monthLastDay } from "./dates";
import { turnoverFilterSchema, type TurnoverFilter } from "./schema";

export const TURNOVER_URL_VERSION = "r1";
export const TURNOVER_URL_PARAM = "r";

export const TURNOVER_PRESETS = ["mes", "trimestre", "anio", "12m"] as const;

export type TurnoverPreset = (typeof TURNOVER_PRESETS)[number];

export const turnoverPresetLabels: Record<TurnoverPreset | "custom", string> = {
  mes: "Último mes",
  trimestre: "Último trimestre",
  anio: "Último año",
  "12m": "Últimos 12 meses",
  custom: "Personalizado",
};

/** The whole, closed months a preset covers, as of `today`. */
export const presetRange = (preset: TurnoverPreset, today: string) => {
  const lastClosed = addMonths(monthKey(today), -1);

  switch (preset) {
    case "mes":
      return {
        from: monthFirstDay(lastClosed),
        to: monthLastDay(lastClosed),
      };
    case "trimestre": {
      const [year, month] = lastClosed.split("-").map(Number);
      const quarterEnd = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 3).padStart(2, "0")}`;
      const end =
        quarterEnd > lastClosed ? addMonths(quarterEnd, -3) : quarterEnd;

      return {
        from: monthFirstDay(addMonths(end, -2)),
        to: monthLastDay(end),
      };
    }
    case "anio": {
      const year = Number(today.slice(0, 4)) - 1;

      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "12m":
      return {
        from: monthFirstDay(addMonths(lastClosed, -11)),
        to: monthLastDay(lastClosed),
      };
  }
};

/** The preset a range is, if any (to highlight it in the picker). */
export const presetOf = (
  filter: Pick<TurnoverFilter, "from" | "to">,
  today: string,
): TurnoverPreset | "custom" =>
  TURNOVER_PRESETS.find((preset) => {
    const range = presetRange(preset, today);

    return range.from === filter.from && range.to === filter.to;
  }) ?? "custom";

export const defaultTurnoverFilter = (today: string): TurnoverFilter =>
  turnoverFilterSchema.parse(presetRange("mes", today));

const KEYS = {
  desde: "from",
  hasta: "to",
  area: "areaIds",
  sucursal: "siteIds",
  puesto: "positionIds",
  jefe: "managerId",
  equipo: "team",
  tipo: "tipos",
  motivo: "motivoIds",
  clase: "classifications",
} as const;

type UrlKey = keyof typeof KEYS;

const LIST_KEYS = new Set<UrlKey>([
  "area",
  "sucursal",
  "puesto",
  "tipo",
  "motivo",
  "clase",
]);

/** Reads `r`; anything invalid falls back to the default (last month). */
export const parseTurnoverParam = (
  param: string | string[] | undefined,
  today: string,
): TurnoverFilter => {
  const fallback = defaultTurnoverFilter(today);
  const value = Array.isArray(param) ? param[0] : param;

  if (!value) return fallback;

  const [version, ...parts] = value.split("*");

  if (version !== TURNOVER_URL_VERSION) return fallback;

  const input: Record<string, unknown> = {
    from: fallback.from,
    to: fallback.to,
  };

  for (const part of parts) {
    const dot = part.indexOf(".");

    if (dot <= 0) continue;

    const key = part.slice(0, dot) as UrlKey;
    const raw = decodeURIComponent(part.slice(dot + 1));

    if (!(key in KEYS)) continue;

    if (LIST_KEYS.has(key)) {
      input[KEYS[key]] = raw.split(",").filter(Boolean);
    } else if (key === "equipo") {
      input.team = raw === "1";
    } else {
      input[KEYS[key]] = raw;
    }
  }

  const parsed = turnoverFilterSchema.safeParse(input);

  if (parsed.success) return parsed.data;

  // Keep the valid range at least; drop whatever made it fail.
  const range = turnoverFilterSchema.safeParse({
    from: input.from,
    to: input.to,
  });

  return range.success ? range.data : fallback;
};

/** Writes the filter as `r` (empty lists and defaults are left out). */
export const serializeTurnoverFilter = (filter: TurnoverFilter) => {
  const parts: string[] = [TURNOVER_URL_VERSION];

  for (const [key, field] of Object.entries(KEYS) as [
    UrlKey,
    (typeof KEYS)[UrlKey],
  ][]) {
    const value = filter[field];

    if (Array.isArray(value)) {
      if (value.length > 0) {
        parts.push(`${key}.${value.map(encodeURIComponent).join(",")}`);
      }
    } else if (key === "equipo") {
      if (value) parts.push("equipo.1");
    } else if (value) {
      parts.push(`${key}.${encodeURIComponent(String(value))}`);
    }
  }

  return parts.join("*");
};

export const turnoverHref = (filter: TurnoverFilter) =>
  `/app/reportes/rotacion?${TURNOVER_URL_PARAM}=${serializeTurnoverFilter(filter)}`;
