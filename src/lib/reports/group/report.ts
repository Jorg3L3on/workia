/**
 * Group dashboard (Workia 2.0 W2-25): headcount, turnover and absenteeism of
 * every subsidiary the reader may see, by company, región and sucursal, in
 * one place. Pure: it takes what ./data loads and returns what the page and
 * the exports show. The contract is in docs/reportes-grupo.md; in short:
 *
 * - Each company's rows are buildAbsenteeismReport over that company's own
 *   inputs, the function the absenteeism report (W2-20) uses, with no región
 *   or sucursal filter. So a company row is, number for number, the total of
 *   that company's «Ausentismo y rotación» for the same range, and each
 *   región and sucursal row is the same row there.
 * - The group row is computed from the union of the companies' rows, never
 *   as a sum or mean of rates. Plantilla, faltas and retardos add up. A
 *   transfer between two subsidiaries of the view (W2-24) is a baja
 *   «traslado» in one and an ingreso in the other: each company counts it,
 *   the group does not, because nobody left the group. They are shown as
 *   «Traslados internos». A transfer to or from a company outside the view
 *   stays a baja or an ingreso of the group.
 */

import type {
  AbsenteeismAggregate,
  IncidenciasAggregate,
} from "@/lib/timeline/aggregates";

import {
  buildAbsenteeismReport,
  type AbsenteeismReport,
  type RegionInfo,
  type ReportRow,
  type SiteInfo,
  type TurnoverCell,
} from "../absenteeism/report";
import {
  exitsIn,
  hiresIn,
  MIN_GROUP_HEADCOUNT,
  rate,
  summarize,
} from "../turnover/metrics";
import type { TurnoverFact } from "../turnover/schema";

import type { GroupFilter } from "./schema";

/** What ./data loads for one company: the absenteeism report's inputs. */
export type CompanyInputs = {
  companyId: string;
  companyName: string;
  facts: TurnoverFact[];
  sites: SiteInfo[];
  regions: RegionInfo[];
  absenteeism: AbsenteeismAggregate[];
  incidencias: IncidenciasAggregate[];
  /**
   * This company's transfers (person_links), by the employment period each
   * one closed (out) or opened (in), with the other subsidiary.
   */
  transfers: Map<string, { direction: "in" | "out"; linkedCompanyId: string }>;
};

export type CompanySection = {
  companyId: string;
  companyName: string;
  /** The company's absenteeism report for the range: total, regiones and sucursales. */
  report: AbsenteeismReport;
  /** Its bajas «traslado» and its ingresos by transfer in the range. */
  transfersOut: number;
  transfersIn: number;
};

export type GroupDashboard = {
  filter: GroupFilter;
  today: string;
  /** The group: plantilla, faltas and retardos add up; transfers are not turnover. */
  total: ReportRow & { transfersOut: number; transfersIn: number };
  /** By company name. */
  companies: CompanySection[];
};

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** The group's turnover over every company's periods, without internal transfers. */
const groupTurnover = (
  facts: TurnoverFact[],
  internal: Set<string>,
  filter: GroupFilter,
): TurnoverCell => {
  const summary = summarize(
    facts,
    filter.from,
    filter.to,
    (fact) => !internal.has(fact.id),
  );
  const shown = summary.headcount >= MIN_GROUP_HEADCOUNT;

  return {
    headcount: summary.headcount,
    exits: summary.exits,
    voluntaryExits: summary.byClass.voluntaria.exits,
    involuntaryExits: summary.byClass.involuntaria.exits,
    hires: hiresIn(facts, filter.from, filter.to).filter(
      (fact) => !internal.has(fact.id),
    ).length,
    rate: shown ? summary.rate : null,
    voluntaryRate: shown ? summary.byClass.voluntaria.rate : null,
    smallSample: summary.smallSample,
  };
};

export const buildGroupDashboard = (input: {
  companies: CompanyInputs[];
  filter: GroupFilter;
  today: string;
}): GroupDashboard => {
  const { filter, today } = input;
  const inView = new Set(input.companies.map((company) => company.companyId));
  /** Periods closed or opened by a transfer between two companies of the view. */
  const internal = new Set<string>();
  const companies = input.companies
    .map((company): CompanySection => {
      const report = buildAbsenteeismReport({
        facts: company.facts,
        sites: company.sites,
        regions: company.regions,
        absenteeism: company.absenteeism,
        incidencias: company.incidencias,
        filter: {
          from: filter.from,
          to: filter.to,
          regionIds: [],
          siteIds: [],
        },
        today,
      });
      const transferOf = (fact: TurnoverFact) => {
        const transfer = company.transfers.get(fact.id);

        return transfer && inView.has(transfer.linkedCompanyId)
          ? transfer.direction
          : null;
      };
      const transfersOut = exitsIn(
        company.facts,
        filter.from,
        filter.to,
      ).filter((fact) => transferOf(fact) === "out");
      const transfersIn = hiresIn(company.facts, filter.from, filter.to).filter(
        (fact) => transferOf(fact) === "in",
      );

      for (const fact of [...transfersOut, ...transfersIn]) {
        internal.add(fact.id);
      }

      return {
        companyId: company.companyId,
        companyName: company.companyName,
        report: {
          ...report,
          total: {
            ...report.total,
            key: company.companyId,
            label: company.companyName,
          },
        },
        transfersOut: transfersOut.length,
        transfersIn: transfersIn.length,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "es"));

  const facts = input.companies.flatMap((company) => company.facts);
  const sums = companies.reduce(
    (acc, company) => {
      const cell = company.report.total.absenteeism;

      return {
        presentDays: acc.presentDays + cell.presentDays,
        absentDays: acc.absentDays + cell.absentDays,
        justifiedAbsentDays: acc.justifiedAbsentDays + cell.justifiedAbsentDays,
        lateDays: acc.lateDays + cell.lateDays,
        lateMinutes: acc.lateMinutes + cell.lateMinutes,
      };
    },
    {
      presentDays: 0,
      absentDays: 0,
      justifiedAbsentDays: 0,
      lateDays: 0,
      lateMinutes: 0,
    },
  );
  const absenteeismRate = rate(
    sums.absentDays,
    sums.presentDays + sums.absentDays,
  );

  return {
    filter,
    today,
    total: {
      key: null,
      label: "Grupo",
      turnover: groupTurnover(facts, internal, filter),
      absenteeism: {
        ...sums,
        rate: absenteeismRate === null ? null : round(absenteeismRate),
      },
      transfersOut: companies.reduce((sum, row) => sum + row.transfersOut, 0),
      transfersIn: companies.reduce((sum, row) => sum + row.transfersIn, 0),
    },
    companies,
  };
};
