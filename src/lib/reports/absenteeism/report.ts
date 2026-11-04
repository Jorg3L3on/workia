/**
 * Absenteeism and turnover by region and sucursal (Workia 2.0 W2-20), as one
 * pure computation over what ./data loads, so the page and the exports always
 * agree. The contract is in docs/reportes-ausentismo.md; in short:
 *
 * - Turnover is the turnover report's (WRK-I12): the same employment periods
 *   (loadTurnoverFacts) and the same summarize(), grouped by the sucursal the
 *   period reports there (the one it froze at its baja, or the person's
 *   current one while open). So a sucursal's bajas are, person by person, the
 *   bajas the turnover report lists for that sucursal.
 * - Absenteeism is the attendance aggregates' (P-02, absenteeismBy): faltas
 *   in force / (days with attendance + faltas), grouped by the person's
 *   current sucursal. Retardos come from incidenciasBy.
 * - A región is the sucursal's current región. A group's numbers are computed
 *   from its own rows, never as a sum or mean of rates.
 * - The turnover rate of a group whose average plantilla is under
 *   MIN_GROUP_HEADCOUNT is hidden, as in the turnover report; its counts stay.
 */

import type {
  AbsenteeismAggregate,
  IncidenciasAggregate,
} from "@/lib/timeline/aggregates";

import { MIN_GROUP_HEADCOUNT, rate, summarize } from "../turnover/metrics";
import type { TurnoverFact } from "../turnover/schema";

import type { AbsenteeismFilter } from "./schema";

export type SiteInfo = {
  id: string;
  name: string;
  regionId: string | null;
  /** Logically deleted: shown only while it still has numbers. */
  deleted: boolean;
};

export type RegionInfo = { id: string; name: string };

export type TurnoverCell = {
  /** Average plantilla of the range, as the turnover report computes it. */
  headcount: number;
  exits: number;
  voluntaryExits: number;
  involuntaryExits: number;
  hires: number;
  /** % of the plantilla; null under MIN_GROUP_HEADCOUNT or without plantilla. */
  rate: number | null;
  voluntaryRate: number | null;
  smallSample: boolean;
};

export type AbsenteeismCell = {
  presentDays: number;
  absentDays: number;
  justifiedAbsentDays: number;
  /** absentDays / (presentDays + absentDays) × 100; null with no days. */
  rate: number | null;
  /** Days with a retardo in force, and their minutes. */
  lateDays: number;
  lateMinutes: number;
};

export type ReportRow = {
  /** Site or region id; null is «Sin sucursal» / «Sin región». */
  key: string | null;
  label: string;
  turnover: TurnoverCell;
  absenteeism: AbsenteeismCell;
};

export type RegionGroup = ReportRow & { sites: ReportRow[] };

export type AbsenteeismReport = {
  filter: AbsenteeismFilter;
  today: string;
  /** The company, or the selected regions and sucursales. */
  total: ReportRow;
  /** Regions by name, then «Sin región» (sucursales without one, and people without a sucursal). */
  regions: RegionGroup[];
};

export const NO_REGION_LABEL = "Sin región";
export const NO_SITE_LABEL = "Sin sucursal";

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

const turnoverCell = (
  facts: TurnoverFact[],
  filter: AbsenteeismFilter,
): TurnoverCell => {
  const summary = summarize(facts, filter.from, filter.to);
  const shown = summary.headcount >= MIN_GROUP_HEADCOUNT;

  return {
    headcount: summary.headcount,
    exits: summary.exits,
    voluntaryExits: summary.byClass.voluntaria.exits,
    involuntaryExits: summary.byClass.involuntaria.exits,
    hires: summary.hires,
    rate: shown ? summary.rate : null,
    voluntaryRate: shown ? summary.byClass.voluntaria.rate : null,
    smallSample: summary.smallSample,
  };
};

const EMPTY_ABSENTEEISM = {
  presentDays: 0,
  absentDays: 0,
  justifiedAbsentDays: 0,
  lateDays: 0,
  lateMinutes: 0,
};

type AbsenteeismSums = typeof EMPTY_ABSENTEEISM;

const addSums = (a: AbsenteeismSums, b: AbsenteeismSums): AbsenteeismSums => ({
  presentDays: a.presentDays + b.presentDays,
  absentDays: a.absentDays + b.absentDays,
  justifiedAbsentDays: a.justifiedAbsentDays + b.justifiedAbsentDays,
  lateDays: a.lateDays + b.lateDays,
  lateMinutes: a.lateMinutes + b.lateMinutes,
});

const absenteeismCell = (sums: AbsenteeismSums): AbsenteeismCell => {
  const rateValue = rate(sums.absentDays, sums.presentDays + sums.absentDays);

  return {
    ...sums,
    rate: rateValue === null ? null : round(rateValue),
  };
};

const hasNumbers = (row: ReportRow) =>
  row.turnover.headcount > 0 ||
  row.turnover.exits > 0 ||
  row.turnover.hires > 0 ||
  row.absenteeism.presentDays > 0 ||
  row.absenteeism.absentDays > 0 ||
  row.absenteeism.lateDays > 0;

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, "es");

/**
 * Whether a sucursal (null: no sucursal) is in the filter: every one without
 * región or sucursal filters; with either, its región and itself must match.
 */
export const siteFilterOf = (
  filter: Pick<AbsenteeismFilter, "regionIds" | "siteIds">,
  sites: SiteInfo[],
) => {
  const regionOf = new Map(sites.map((site) => [site.id, site.regionId]));
  const filtered = filter.regionIds.length > 0 || filter.siteIds.length > 0;

  return (siteId: string | null) => {
    if (!filtered) return true;
    if (siteId === null) return false;

    const regionId = regionOf.get(siteId) ?? null;

    return (
      (filter.regionIds.length === 0 ||
        (regionId !== null && filter.regionIds.includes(regionId))) &&
      (filter.siteIds.length === 0 || filter.siteIds.includes(siteId))
    );
  };
};

export const buildAbsenteeismReport = (input: {
  facts: TurnoverFact[];
  sites: SiteInfo[];
  regions: RegionInfo[];
  /** absenteeismBy(…, { by: "site" }) of the range. */
  absenteeism: AbsenteeismAggregate[];
  /** incidenciasBy(…, { by: "site" }) of the range. */
  incidencias: IncidenciasAggregate[];
  filter: AbsenteeismFilter;
  today: string;
}): AbsenteeismReport => {
  const { filter } = input;
  const siteById = new Map(input.sites.map((site) => [site.id, site]));
  const regionName = new Map(
    input.regions.map((region) => [region.id, region.name]),
  );
  const included = siteFilterOf(filter, input.sites);

  const factsBySite = new Map<string | null, TurnoverFact[]>();

  for (const fact of input.facts) {
    if (!included(fact.siteId)) continue;

    const list = factsBySite.get(fact.siteId);

    if (list) list.push(fact);
    else factsBySite.set(fact.siteId, [fact]);
  }

  const sumsBySite = new Map<string | null, AbsenteeismSums>();
  const sumsOf = (key: string | null) =>
    sumsBySite.get(key) ?? { ...EMPTY_ABSENTEEISM };

  for (const row of input.absenteeism) {
    if (!included(row.key)) continue;

    sumsBySite.set(
      row.key,
      addSums(sumsOf(row.key), {
        ...EMPTY_ABSENTEEISM,
        presentDays: row.presentDays,
        absentDays: row.absentDays,
        justifiedAbsentDays: row.justifiedAbsentDays,
      }),
    );
  }

  for (const row of input.incidencias) {
    if (row.kind !== "retardo" || !included(row.key)) continue;

    sumsBySite.set(
      row.key,
      addSums(sumsOf(row.key), {
        ...EMPTY_ABSENTEEISM,
        lateDays: row.count,
        lateMinutes: row.minutes,
      }),
    );
  }

  // Every sucursal with numbers, every live one the filter keeps, and the
  // people without a sucursal.
  const siteKeys = new Set<string | null>([
    ...factsBySite.keys(),
    ...sumsBySite.keys(),
    ...input.sites
      .filter((site) => !site.deleted && included(site.id))
      .map((site) => site.id),
  ]);

  const rowOf = (
    key: string | null,
    label: string,
    siteKeysOfRow: (string | null)[],
  ): ReportRow => ({
    key,
    label,
    turnover: turnoverCell(
      siteKeysOfRow.flatMap((site) => factsBySite.get(site) ?? []),
      filter,
    ),
    absenteeism: absenteeismCell(
      siteKeysOfRow.reduce<AbsenteeismSums>(
        (sums, site) => addSums(sums, sumsOf(site)),
        { ...EMPTY_ABSENTEEISM },
      ),
    ),
  });

  const sitesOfRegion = new Map<string | null, (string | null)[]>();

  for (const key of siteKeys) {
    const site = key === null ? null : siteById.get(key);
    // A sucursal the catalog no longer has, or no sucursal: «Sin región».
    const regionId = site?.regionId ?? null;
    const list = sitesOfRegion.get(regionId);

    if (list) list.push(key);
    else sitesOfRegion.set(regionId, [key]);
  }

  const siteRow = (key: string | null) => {
    const row = rowOf(
      key,
      key === null ? NO_SITE_LABEL : (siteById.get(key)?.name ?? "(Borrada)"),
      [key],
    );
    const site = key === null ? null : siteById.get(key);

    return site && !site.deleted ? row : hasNumbers(row) ? row : null;
  };

  const regions: RegionGroup[] = [...sitesOfRegion.entries()]
    .map(([regionId, keys]) => {
      const sites = keys
        .map(siteRow)
        .filter((row): row is ReportRow => row !== null)
        .sort((a, b) =>
          a.key === null ? 1 : b.key === null ? -1 : byLabel(a, b),
        );

      return {
        ...rowOf(
          regionId,
          regionId === null
            ? NO_REGION_LABEL
            : (regionName.get(regionId) ?? "(Borrada)"),
          keys,
        ),
        sites,
      };
    })
    .filter((region) => region.sites.length > 0)
    .sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : byLabel(a, b)));

  return {
    filter,
    today: input.today,
    total: rowOf(null, "Total", [...siteKeys]),
    regions,
  };
};
