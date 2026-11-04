/**
 * The report's filter in the URL (W2-20): one versioned `a` parameter, like
 * the turnover report's `r` but with its own version so links never mix.
 *
 *   ?a=a1*desde.2026-10-01*hasta.2026-10-31*region.<id>*sucursal.<id>,<id>
 *
 * The presets are the turnover report's (whole closed months). Unknown
 * versions, keys and invalid values are ignored: a broken link falls back to
 * the last month.
 */

import { presetRange } from "../turnover/url";

import { absenteeismFilterSchema, type AbsenteeismFilter } from "./schema";

export const ABSENTEEISM_URL_VERSION = "a1";
export const ABSENTEEISM_URL_PARAM = "a";
export const ABSENTEEISM_PATH = "/app/reportes/ausentismo";

export const defaultAbsenteeismFilter = (today: string): AbsenteeismFilter =>
  absenteeismFilterSchema.parse(presetRange("mes", today));

const KEYS = {
  desde: "from",
  hasta: "to",
  region: "regionIds",
  sucursal: "siteIds",
} as const;

type UrlKey = keyof typeof KEYS;

const LIST_KEYS = new Set<UrlKey>(["region", "sucursal"]);

export const parseAbsenteeismParam = (
  param: string | string[] | undefined,
  today: string,
): AbsenteeismFilter => {
  const fallback = defaultAbsenteeismFilter(today);
  const value = Array.isArray(param) ? param[0] : param;

  if (!value) return fallback;

  const [version, ...parts] = value.split("*");

  if (version !== ABSENTEEISM_URL_VERSION) return fallback;

  const input: Record<string, unknown> = {
    from: fallback.from,
    to: fallback.to,
  };

  for (const part of parts) {
    const dot = part.indexOf(".");

    if (dot <= 0) continue;

    const key = part.slice(0, dot) as UrlKey;

    if (!(key in KEYS)) continue;

    let raw: string;

    try {
      raw = decodeURIComponent(part.slice(dot + 1));
    } catch {
      continue;
    }

    input[KEYS[key]] = LIST_KEYS.has(key)
      ? raw.split(",").filter(Boolean)
      : raw;
  }

  const parsed = absenteeismFilterSchema.safeParse(input);

  if (parsed.success) return parsed.data;

  const range = absenteeismFilterSchema.safeParse({
    from: input.from,
    to: input.to,
  });

  return range.success ? range.data : fallback;
};

export const serializeAbsenteeismFilter = (filter: AbsenteeismFilter) => {
  const parts: string[] = [ABSENTEEISM_URL_VERSION];

  for (const [key, field] of Object.entries(KEYS) as [
    UrlKey,
    (typeof KEYS)[UrlKey],
  ][]) {
    const value = filter[field];

    if (Array.isArray(value)) {
      if (value.length > 0) {
        parts.push(`${key}.${value.map(encodeURIComponent).join(",")}`);
      }
    } else if (value) {
      parts.push(`${key}.${encodeURIComponent(value)}`);
    }
  }

  return parts.join("*");
};

export const absenteeismHref = (filter: AbsenteeismFilter) =>
  `${ABSENTEEISM_PATH}?${ABSENTEEISM_URL_PARAM}=${serializeAbsenteeismFilter(filter)}`;
