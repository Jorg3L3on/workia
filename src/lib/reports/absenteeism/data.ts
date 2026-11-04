import { tdb } from "@/lib/db";
import { people, regions, sites } from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";
import { absenteeismBy, incidenciasBy } from "@/lib/timeline/aggregates";

import { loadTurnoverFacts } from "../turnover/data";
import { exitClassification, exitsIn } from "../turnover/metrics";

import {
  buildAbsenteeismReport,
  siteFilterOf,
  type AbsenteeismReport,
  type RegionInfo,
  type SiteInfo,
} from "./report";
import type { AbsenteeismFilter } from "./schema";

/**
 * Sucursales and regiones of the company, deleted ones included: history may
 * still point at them. Scoped by company explicitly.
 */
export const loadReportStructure = async (
  companyId: string,
): Promise<{ sites: SiteInfo[]; regions: RegionInfo[] }> => {
  const [siteRows, regionRows] = await Promise.all([
    tdb(companyId)
      .select({
        id: sites.id,
        name: sites.name,
        regionId: sites.regionId,
        deletedAt: sites.deletedAt,
      })
      .from(sites)
      .where(withTenant(sites, companyId)),
    tdb(companyId)
      .select({ id: regions.id, name: regions.name })
      .from(regions)
      .where(withTenant(regions, companyId)),
  ]);

  return {
    sites: siteRows.map(({ deletedAt, ...site }) => ({
      ...site,
      deleted: deletedAt !== null,
    })),
    regions: regionRows,
  };
};

/**
 * What buildAbsenteeismReport computes from for `companyId` and a range: the
 * turnover report's periods, the catalog and the attendance aggregates by
 * sucursal, read in parallel. The group dashboard (W2-25) reads the same.
 */
export const loadAbsenteeismInputs = async (
  companyId: string,
  range: { from: string; to: string },
) => {
  const days = { from: range.from, to: range.to };
  const [facts, structure, absenteeism, incidencias] = await Promise.all([
    loadTurnoverFacts(companyId),
    loadReportStructure(companyId),
    absenteeismBy(companyId, days, { by: "site" }),
    incidenciasBy(companyId, days, { by: "site" }),
  ]);

  return { facts, structure, absenteeism, incidencias };
};

/**
 * The report of `companyId` (one subsidiary) for `filter`: the turnover
 * report's periods, the attendance aggregates by sucursal and the catalog,
 * read in parallel and computed by buildAbsenteeismReport.
 */
export const getAbsenteeismReport = async (
  companyId: string,
  filter: AbsenteeismFilter,
  today: string,
): Promise<
  AbsenteeismReport & {
    structure: Awaited<ReturnType<typeof loadReportStructure>>;
  }
> => {
  const { facts, structure, absenteeism, incidencias } =
    await loadAbsenteeismInputs(companyId, filter);

  return {
    ...buildAbsenteeismReport({
      facts,
      ...structure,
      absenteeism,
      incidencias,
      filter,
      today,
    }),
    structure,
  };
};

export type AbsenteeismExitRow = {
  periodId: string;
  personId: string;
  personName: string;
  fechaIngreso: string | null;
  fechaBaja: string;
  classification: ReturnType<typeof exitClassification>;
  siteId: string | null;
  regionId: string | null;
};

export type AbsenteeismPersonRow = {
  personId: string;
  personName: string;
  siteId: string | null;
  regionId: string | null;
  presentDays: number;
  absentDays: number;
  justifiedAbsentDays: number;
  rate: number | null;
};

/**
 * The people behind the numbers, for the export (people:read and
 * people:export): every baja of the range with the sucursal it counts for
 * (the same rows as the turnover report's Bajas sheet for that sucursal), and
 * every person's attendance days and faltas with their current sucursal.
 */
export const loadAbsenteeismDetail = async (
  companyId: string,
  filter: AbsenteeismFilter,
  siteList: SiteInfo[],
): Promise<{ exits: AbsenteeismExitRow[]; people: AbsenteeismPersonRow[] }> => {
  const range = { from: filter.from, to: filter.to };
  const included = siteFilterOf(filter, siteList);
  const regionOf = new Map(siteList.map((site) => [site.id, site.regionId]));
  const [facts, byPerson, personRows] = await Promise.all([
    loadTurnoverFacts(companyId),
    absenteeismBy(companyId, range, { by: "person" }),
    tdb(companyId)
      .select({
        id: people.id,
        siteId: people.siteId,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
      })
      .from(people)
      .where(withTenant(people, companyId)),
  ]);
  const personById = new Map(personRows.map((row) => [row.id, row]));
  const exits = exitsIn(facts, filter.from, filter.to)
    .filter((fact) => included(fact.siteId))
    .map((fact) => ({
      periodId: fact.id,
      personId: fact.personId,
      personName: fact.personName,
      fechaIngreso: fact.fechaIngreso,
      fechaBaja: fact.fechaBaja!,
      classification: exitClassification(fact),
      siteId: fact.siteId,
      regionId: fact.siteId ? (regionOf.get(fact.siteId) ?? null) : null,
    }))
    .sort(
      (a, b) =>
        a.fechaBaja.localeCompare(b.fechaBaja) ||
        a.personName.localeCompare(b.personName, "es"),
    );
  const peopleRows = byPerson
    .flatMap((row): AbsenteeismPersonRow[] => {
      const person = row.key ? personById.get(row.key) : undefined;

      if (!person || !included(person.siteId)) return [];

      return [
        {
          personId: person.id,
          personName: formatPersonName(person),
          siteId: person.siteId,
          regionId: person.siteId
            ? (regionOf.get(person.siteId) ?? null)
            : null,
          presentDays: row.presentDays,
          absentDays: row.absentDays,
          justifiedAbsentDays: row.justifiedAbsentDays,
          rate: row.rate === null ? null : Math.round(row.rate * 10000) / 100,
        },
      ];
    })
    .sort((a, b) => a.personName.localeCompare(b.personName, "es"));

  return { exits, people: peopleRows };
};
