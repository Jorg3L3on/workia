/**
 * The turnover report as one pure computation (WRK-I12): every number the
 * dashboard, the drill-down and the exports show comes from here, so they
 * always agree. Loading lives in ./data and ./index.
 */

import type { TerminationClassification } from "@/lib/db/schema/employment";

import {
  addMonths,
  daysBetween,
  isWholeMonths,
  monthKey,
  monthsBetween,
  previousRange,
  shiftRangeByMonths,
} from "./dates";
import { teamOf, type TurnoverLabels } from "./labels";
import {
  breakdown,
  cohorts,
  exitClassification,
  exitsIn,
  hiresIn,
  monthlyTrend,
  OTHERS_KEY,
  reasonBreakdown,
  rollingYear,
  summarize,
  tenureAtExit,
  trialFunnel,
  type BreakdownRow,
  type CohortRow,
  type ReasonRow,
  type TrendPoint,
  type TrialFunnel,
  type TurnoverSummary,
} from "./metrics";
import {
  TURNOVER_DIMENSIONS,
  type TurnoverDimension,
  type TurnoverFact,
  type TurnoverFilter,
} from "./schema";

/** Months of trend and cohorts the dashboard draws. */
export const TREND_MONTHS = 12;

export type LabeledBreakdownRow = BreakdownRow & { label: string };

/** One period behind a number, for the drill-down (no payroll data). */
export type TurnoverDetailRow = {
  id: string;
  personId: string;
  personName: string;
  fechaIngreso: string | null;
  fechaBaja: string | null;
  days: number | null;
  tipoBaja: TurnoverFact["tipoBaja"];
  motivo: string | null;
  classification: TerminationClassification | null;
  recontratable: boolean | null;
  firstOfPerson: boolean;
  areaId: string | null;
  siteId: string | null;
  positionId: string | null;
  managerId: string | null;
};

export type TurnoverReport = {
  filter: TurnoverFilter;
  today: string;
  months: number;
  summary: TurnoverSummary;
  previous: TurnoverSummary;
  lastYear: TurnoverSummary | null;
  rolling: ReturnType<typeof rollingYear>;
  trend: TrendPoint[];
  trendLastYear: TrendPoint[];
  cohorts: CohortRow[];
  funnel: TrialFunnel;
  breakdowns: Record<TurnoverDimension, LabeledBreakdownRow[]>;
  reasons: ReasonRow[];
  tenure: ReturnType<typeof tenureAtExit>;
  /** First month with a recorded baja; before it the trend has no history. */
  historyStart: string | null;
  historyMonths: number;
  goal: {
    /** Monthly goal in %, or null when the company set none. */
    monthly: number | null;
    /** The goal scaled to the range (monthly × months). */
    forRange: number | null;
  };
  quality: {
    sinFecha: number;
    inferidas: number;
    sinIngreso: number;
    requiereRevision: number;
    unclassifiedReasons: number;
  };
  /** Bajas and ingresos of the range (filled only for people:read). */
  detail: { exits: TurnoverDetailRow[]; hires: TurnoverDetailRow[] } | null;
};

/** The filtered population: área, sucursal, puesto and jefe (or team). */
export const populationOf = (
  facts: TurnoverFact[],
  filter: TurnoverFilter,
  labels: Pick<TurnoverLabels, "reportsOf">,
) => {
  const inList = (list: string[], value: string | null) =>
    list.length === 0 || (value !== null && list.includes(value));
  const managers = filter.managerId
    ? new Set([
        filter.managerId,
        ...(filter.team ? teamOf(filter.managerId, labels.reportsOf) : []),
      ])
    : null;

  return facts.filter(
    (fact) =>
      inList(filter.areaIds, fact.areaId) &&
      inList(filter.siteIds, fact.siteId) &&
      inList(filter.positionIds, fact.positionId) &&
      (!managers || (fact.managerId !== null && managers.has(fact.managerId))),
  );
};

/** Which bajas count: tipo, motivo and clasificación narrow the numerator only. */
export const countedBy =
  (filter: TurnoverFilter) =>
  (fact: TurnoverFact): boolean =>
    (filter.tipos.length === 0 ||
      (fact.tipoBaja !== null && filter.tipos.includes(fact.tipoBaja))) &&
    (filter.motivoIds.length === 0 ||
      (fact.motivoId !== null && filter.motivoIds.includes(fact.motivoId))) &&
    (filter.classifications.length === 0 ||
      filter.classifications.includes(exitClassification(fact)));

const labelOf = (
  dimension: TurnoverDimension,
  key: string | null,
  labels: TurnoverLabels,
) => {
  if (key === OTHERS_KEY) return "Otros";

  const empty: Record<TurnoverDimension, string> = {
    area: "Sin área",
    site: "Sin sucursal",
    position: "Sin puesto",
    manager: "Sin jefe",
  };

  if (key === null) return empty[dimension];

  const names: Record<TurnoverDimension, Record<string, string>> = {
    area: labels.areas,
    site: labels.sites,
    position: labels.positions,
    manager: labels.managers,
  };

  return names[dimension][key] ?? "(Borrado)";
};

const detailRow = (fact: TurnoverFact): TurnoverDetailRow => ({
  id: fact.id,
  personId: fact.personId,
  personName: fact.personName,
  fechaIngreso: fact.fechaIngreso,
  fechaBaja: fact.fechaBaja,
  days:
    fact.fechaIngreso && fact.fechaBaja
      ? daysBetween(fact.fechaIngreso, fact.fechaBaja) + 1
      : null,
  tipoBaja: fact.tipoBaja,
  motivo: fact.motivoName,
  classification: fact.fechaBaja ? exitClassification(fact) : null,
  recontratable: fact.recontratable,
  firstOfPerson: fact.firstOfPerson,
  areaId: fact.areaId,
  siteId: fact.siteId,
  positionId: fact.positionId,
  managerId: fact.managerId,
});

export const buildTurnoverReport = (
  facts: TurnoverFact[],
  filter: TurnoverFilter,
  context: {
    labels: TurnoverLabels;
    goal: number | null;
    today: string;
    unclassifiedReasons: number;
    withDetail: boolean;
  },
): TurnoverReport => {
  const { labels, today } = context;
  const population = populationOf(facts, filter, labels);
  const isCounted = countedBy(filter);
  const exitDates = facts
    .map((fact) => fact.fechaBaja)
    .filter((date): date is string => date !== null)
    .sort();
  const historyStart = exitDates.length ? monthKey(exitDates[0]) : null;
  const endMonth = monthKey(filter.to);
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, index) =>
    addMonths(endMonth, index - (TREND_MONTHS - 1)),
  );
  const previous = previousRange(filter.from, filter.to);
  const lastYear = shiftRangeByMonths(filter.from, filter.to, -12);
  // Whole months count as such; any other range in 30.4-day months.
  const rangeMonths = isWholeMonths(filter.from, filter.to)
    ? monthsBetween(filter.from, filter.to).length
    : (daysBetween(filter.from, filter.to) + 1) / 30.4;
  const exits = exitsIn(population, filter.from, filter.to).filter(isCounted);

  return {
    filter,
    today,
    months: Math.round(rangeMonths * 10) / 10,
    summary: summarize(population, filter.from, filter.to, isCounted),
    previous: summarize(population, previous.from, previous.to, isCounted),
    lastYear:
      historyStart && monthKey(lastYear.to) >= historyStart
        ? summarize(population, lastYear.from, lastYear.to, isCounted)
        : null,
    rolling: rollingYear(population, endMonth, historyStart, isCounted),
    trend: monthlyTrend(population, trendMonths, isCounted),
    trendLastYear: monthlyTrend(
      population,
      trendMonths.map((month) => addMonths(month, -12)),
      isCounted,
    ),
    cohorts: cohorts(population, trendMonths, today),
    funnel: trialFunnel(population, filter.from, filter.to, today),
    breakdowns: Object.fromEntries(
      TURNOVER_DIMENSIONS.map((dimension) => [
        dimension,
        breakdown(population, dimension, filter.from, filter.to, isCounted).map(
          (row) => ({
            ...row,
            label: labelOf(dimension, row.key, labels),
          }),
        ),
      ]),
    ) as Record<TurnoverDimension, LabeledBreakdownRow[]>,
    reasons: reasonBreakdown(exits),
    tenure: tenureAtExit(exits),
    historyStart,
    historyMonths: historyStart
      ? Math.max(0, monthsBetween(`${historyStart}-01`, filter.to).length)
      : 0,
    goal: {
      monthly: context.goal,
      forRange:
        context.goal === null
          ? null
          : Math.round(context.goal * rangeMonths * 100) / 100,
    },
    quality: {
      sinFecha: population.filter((fact) => fact.bajaSinFecha).length,
      inferidas: population.filter((fact) => fact.fechaBajaInferida).length,
      sinIngreso: population.filter((fact) => fact.fechaIngreso === null)
        .length,
      requiereRevision: population.filter((fact) => fact.requiereRevision)
        .length,
      unclassifiedReasons: context.unclassifiedReasons,
    },
    detail: context.withDetail
      ? {
          exits: exits.map(detailRow),
          hires: hiresIn(population, filter.from, filter.to).map(detailRow),
        }
      : null,
  };
};

/**
 * The report of `companyId` for `filter`. `withDetail` adds the people behind
 * the numbers: only for callers with people:read.
 */
