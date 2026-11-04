/**
 * The group dashboard's filter in the URL (W2-25): one versioned `g`
 * parameter, like the absenteeism report's `a`.
 *
 *   ?g=g1*desde.2026-10-01*hasta.2026-10-31*empresa.<id>,<id>
 *
 * Unknown versions, keys and invalid values are ignored: a broken link falls
 * back to the last closed month of every subsidiary.
 */

import { presetRange } from "../turnover/url";

import { groupFilterSchema, type GroupFilter } from "./schema";

export const GROUP_URL_VERSION = "g1";
export const GROUP_URL_PARAM = "g";
export const GROUP_PATH = "/app/reportes/grupo";

export const defaultGroupFilter = (today: string): GroupFilter =>
  groupFilterSchema.parse(presetRange("mes", today));

const KEYS = { desde: "from", hasta: "to", empresa: "companyIds" } as const;

type UrlKey = keyof typeof KEYS;

export const parseGroupParam = (
  param: string | string[] | undefined,
  today: string,
): GroupFilter => {
  const fallback = defaultGroupFilter(today);
  const value = Array.isArray(param) ? param[0] : param;

  if (!value) return fallback;

  const [version, ...parts] = value.split("*");

  if (version !== GROUP_URL_VERSION) return fallback;

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

    input[KEYS[key]] = key === "empresa" ? raw.split(",").filter(Boolean) : raw;
  }

  const parsed = groupFilterSchema.safeParse(input);

  if (parsed.success) return parsed.data;

  const range = groupFilterSchema.safeParse({ from: input.from, to: input.to });

  return range.success ? range.data : fallback;
};

export const serializeGroupFilter = (filter: GroupFilter) => {
  const parts: string[] = [
    GROUP_URL_VERSION,
    `desde.${filter.from}`,
    `hasta.${filter.to}`,
  ];

  if (filter.companyIds.length > 0) {
    parts.push(
      `empresa.${filter.companyIds.map(encodeURIComponent).join(",")}`,
    );
  }

  return parts.join("*");
};

export const groupHref = (filter: GroupFilter) =>
  `${GROUP_PATH}?${GROUP_URL_PARAM}=${serializeGroupFilter(filter)}`;
