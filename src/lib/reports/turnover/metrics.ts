/**
 * The turnover report's metrics (WRK-I12), as pure functions over employment
 * periods. The contract lives in docs/reportes-rotacion.md and the pinned
 * decisions of WRK-I12; in short:
 *
 * - A baja is a period with fecha_baja in the range; «sin fecha» ones never
 *   count (they are listed for review).
 * - Active on day d: ingreso ≤ d (or unknown) and baja ≥ d. Active at the
 *   close of d: baja > d, so whoever leaves on the last day of a month is a
 *   baja of that month and in neither its final nor next month's headcount.
 * - Plantilla of a month = (active on the 1st + active at the close of the
 *   last day) / 2; of several whole months, the mean of the monthly ones.
 * - Rate = bajas / plantilla × 100; never a sum or mean of monthly rates.
 * - Classification comes from the motivo; without one, from the tipo.
 * - Salida en prueba: the baja is on or before day 90 of the period
 *   (ingreso is day 1), so not renewing a 90-day contract counts.
 */

import type { TerminationClassification } from "@/lib/db/schema/employment";

import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isWholeMonths,
  monthFirstDay,
  monthKey,
  monthLastDay,
  monthsBetween,
} from "./dates";
import type { TurnoverDimension, TurnoverFact } from "./schema";

/** Days of a probation contract: a baja within them is a salida en prueba. */
export const TRIAL_DAYS = 90;
export const COHORT_DAYS = [30, 60, 90] as const;
/** Groups below this plantilla go to «Otros» (privacy, noisy rates). */
export const MIN_GROUP_HEADCOUNT = 5;
/** Below this plantilla or these hires a number is a «muestra pequeña». */
export const SMALL_SAMPLE_HEADCOUNT = 10;
export const SMALL_COHORT = 5;

type Period = Pick<TurnoverFact, "fechaIngreso" | "fechaBaja" | "bajaSinFecha">;

export const isActiveOn = (period: Period, day: string) =>
  !period.bajaSinFecha &&
  (period.fechaIngreso === null || period.fechaIngreso <= day) &&
  (period.fechaBaja === null || period.fechaBaja >= day);

export const isActiveAtClose = (period: Period, day: string) =>
  !period.bajaSinFecha &&
  (period.fechaIngreso === null || period.fechaIngreso <= day) &&
  (period.fechaBaja === null || period.fechaBaja > day);

/** Days worked in the period, ingreso being day 1; null without both dates. */
export const daysWorked = (period: Period) =>
  period.fechaIngreso && period.fechaBaja
    ? daysBetween(period.fechaIngreso, period.fechaBaja) + 1
    : null;

/** A baja on or before day 90 of its own period (never recognized seniority). */
export const isTrialExit = (period: Period) => {
  const days = daysWorked(period);

  return days !== null && days <= TRIAL_DAYS;
};

export const rate = (exits: number, headcount: number) =>
  headcount > 0 ? (exits / headcount) * 100 : null;

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

// ── Headcount ──────────────────────────────────────────────────────────

export type MonthHeadcount = {
  month: string;
  start: number;
  end: number;
  /** (start + end) / 2: the official denominator. */
  average: number;
  /** Σ days active / days of the month: shown as support only. */
  dailyAverage: number;
};

/** Start, end and official average of a month (string comparisons only). */
const monthCounts = (periods: Period[], month: string) => {
  const first = monthFirstDay(month);
  const last = monthLastDay(month);
  let start = 0;
  let end = 0;

  for (const period of periods) {
    if (isActiveOn(period, first)) start += 1;
    if (isActiveAtClose(period, last)) end += 1;
  }

  return { start, end, average: (start + end) / 2 };
};

export const monthHeadcount = (
  periods: Period[],
  month: string,
): MonthHeadcount => {
  const first = monthFirstDay(month);
  const last = monthLastDay(month);
  let activeDays = 0;

  for (const period of periods) {
    if (period.bajaSinFecha) continue;

    const from =
      period.fechaIngreso && period.fechaIngreso > first
        ? period.fechaIngreso
        : first;
    const to =
      period.fechaBaja && period.fechaBaja < last ? period.fechaBaja : last;

    if (from <= to) activeDays += daysBetween(from, to) + 1;
  }

  return {
    month,
    ...monthCounts(periods, month),
    dailyAverage: round(activeDays / daysInMonth(month)),
  };
};

/**
 * Average plantilla of a range: the mean of its monthly plantillas when it is
 * whole months, otherwise (active at its start + active at its close) / 2.
 */
export const rangeHeadcount = (periods: Period[], from: string, to: string) => {
  if (isWholeMonths(from, to)) {
    const months = monthsBetween(from, to).map((month) =>
      monthCounts(periods, month),
    );

    return (
      months.reduce((sum, month) => sum + month.average, 0) / months.length
    );
  }

  const start = periods.filter((period) => isActiveOn(period, from)).length;
  const end = periods.filter((period) => isActiveAtClose(period, to)).length;

  return (start + end) / 2;
};

// ── Bajas ──────────────────────────────────────────────────────────────

/** Who decided: the motivo's classification, else the tipo; unclassified → otra. */
export const exitClassification = (
  fact: Pick<TurnoverFact, "motivoId" | "motivoClassification" | "tipoBaja">,
): TerminationClassification => {
  if (fact.motivoId) return fact.motivoClassification ?? "otra";

  switch (fact.tipoBaja) {
    case "voluntaria":
      return "voluntaria";
    case "despido":
    case "termino_contrato":
      return "involuntaria";
    default:
      return "otra";
  }
};

export const exitsIn = <T extends Period>(
  periods: T[],
  from: string,
  to: string,
) =>
  periods.filter(
    (period) =>
      period.fechaBaja !== null &&
      period.fechaBaja >= from &&
      period.fechaBaja <= to,
  );

export const hiresIn = <T extends Period>(
  periods: T[],
  from: string,
  to: string,
) =>
  periods.filter(
    (period) =>
      !period.bajaSinFecha &&
      period.fechaIngreso !== null &&
      period.fechaIngreso >= from &&
      period.fechaIngreso <= to,
  );

const median = (values: number[]) => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export type TurnoverSummary = {
  from: string;
  to: string;
  headcount: number;
  exits: number;
  rate: number | null;
  byClass: Record<
    TerminationClassification,
    { exits: number; rate: number | null }
  >;
  /** Bajas without a motivo (classified by their tipo). */
  exitsWithoutMotivo: number;
  hires: number;
  trial: {
    /** Bajas on or before day 90 of their period. */
    exits: number;
    /** Bajas whose period has a fecha de ingreso (the share's base). */
    exitsWithIngreso: number;
    /** % of bajas that were salidas en prueba. */
    share: number | null;
    /** Salidas en prueba / ingresos of the range × 100. */
    ofHires: number | null;
  };
  tenure: { meanDays: number | null; medianDays: number | null };
  reentries: {
    count: number;
    rate: number | null;
    /** Rehires whose previous period ended «recontratable = no». */
    notRehireable: number;
  };
  smallSample: boolean;
};

/**
 * Everything the hero and the KPIs need for one range. `population` is every
 * period of the filtered population (it sets the plantilla); `isCounted`
 * narrows which of its bajas count (tipo, motivo, clasificación filters).
 */
export const summarize = (
  population: TurnoverFact[],
  from: string,
  to: string,
  isCounted: (fact: TurnoverFact) => boolean = () => true,
): TurnoverSummary => {
  const headcount = rangeHeadcount(population, from, to);
  const exits = exitsIn(population, from, to).filter(isCounted);
  const hires = hiresIn(population, from, to);
  const byClass = {
    voluntaria: 0,
    involuntaria: 0,
    otra: 0,
  } satisfies Record<TerminationClassification, number>;

  for (const exit of exits) byClass[exitClassification(exit)] += 1;

  const withIngreso = exits.filter((exit) => exit.fechaIngreso !== null);
  const trialExits = withIngreso.filter(isTrialExit).length;
  const days = withIngreso.map((exit) => daysWorked(exit)!);
  const rehires = hires.filter((hire) => !hire.firstOfPerson);

  return {
    from,
    to,
    headcount: round(headcount),
    exits: exits.length,
    rate: rate(exits.length, headcount),
    byClass: {
      voluntaria: {
        exits: byClass.voluntaria,
        rate: rate(byClass.voluntaria, headcount),
      },
      involuntaria: {
        exits: byClass.involuntaria,
        rate: rate(byClass.involuntaria, headcount),
      },
      otra: { exits: byClass.otra, rate: rate(byClass.otra, headcount) },
    },
    exitsWithoutMotivo: exits.filter((exit) => !exit.motivoId).length,
    hires: hires.length,
    trial: {
      exits: trialExits,
      exitsWithIngreso: withIngreso.length,
      share: rate(trialExits, withIngreso.length),
      ofHires: rate(trialExits, hires.length),
    },
    tenure: {
      meanDays: days.length
        ? round(days.reduce((sum, value) => sum + value, 0) / days.length, 1)
        : null,
      medianDays: median(days),
    },
    reentries: {
      count: rehires.length,
      rate: rate(rehires.length, hires.length),
      notRehireable: rehires.filter(
        (hire) => hire.previousRecontratable === false,
      ).length,
    },
    smallSample: headcount < SMALL_SAMPLE_HEADCOUNT,
  };
};

// ── Trend, rolling year ────────────────────────────────────────────────

export type TrendPoint = MonthHeadcount & {
  exits: number;
  byClass: Record<TerminationClassification, number>;
  rate: number | null;
};

export const monthlyTrend = (
  population: TurnoverFact[],
  months: string[],
  isCounted: (fact: TurnoverFact) => boolean = () => true,
): TrendPoint[] =>
  months.map((month) => {
    const headcount = monthHeadcount(population, month);
    const exits = exitsIn(
      population,
      monthFirstDay(month),
      monthLastDay(month),
    ).filter(isCounted);
    const byClass = { voluntaria: 0, involuntaria: 0, otra: 0 };

    for (const exit of exits) byClass[exitClassification(exit)] += 1;

    return {
      ...headcount,
      exits: exits.length,
      byClass,
      rate: rate(exits.length, headcount.average),
    };
  });

/**
 * The yearly rate: bajas of the last 12 months / mean of their 12 monthly
 * plantillas. With fewer than 12 months of history it is «estimada»:
 * 1 − (1 − mean monthly rate)^12 over the months there are.
 */
export const rollingYear = (
  population: TurnoverFact[],
  endMonth: string,
  historyStart: string | null,
  isCounted: (fact: TurnoverFact) => boolean = () => true,
) => {
  const months = Array.from({ length: 12 }, (_, index) =>
    addMonths(endMonth, index - 11),
  );
  const available = historyStart
    ? months.filter((month) => month >= historyStart)
    : [];

  if (available.length === 0) {
    return { rate: null, estimated: false, months: 0, exits: 0 };
  }

  const trend = monthlyTrend(population, available, isCounted);
  const exits = trend.reduce((sum, point) => sum + point.exits, 0);
  const headcount =
    trend.reduce((sum, point) => sum + point.average, 0) / trend.length;

  if (available.length === 12) {
    return {
      rate: rate(exits, headcount),
      estimated: false,
      months: 12,
      exits,
    };
  }

  const rates = trend
    .map((point) => point.rate)
    .filter((value): value is number => value !== null);

  if (rates.length === 0) {
    return { rate: null, estimated: true, months: available.length, exits };
  }

  const monthly = rates.reduce((sum, value) => sum + value, 0) / rates.length;

  return {
    rate: (1 - (1 - monthly / 100) ** 12) * 100,
    estimated: true,
    months: available.length,
    exits,
  };
};

// ── 90-day trial: cohorts and funnel ───────────────────────────────────

export type CohortCell = {
  days: (typeof COHORT_DAYS)[number];
  /** Every hire of the month is past that day. */
  mature: boolean;
  retained: number;
  rate: number | null;
};

export type CohortRow = {
  month: string;
  hires: number;
  cells: CohortCell[];
  smallSample: boolean;
};

const cohortFacts = (population: TurnoverFact[]) =>
  population.filter((fact) => !fact.bajaSinFecha && fact.fechaIngreso !== null);

/** Retention at day 30, 60 and 90 of each month's hires. */
export const cohorts = (
  population: TurnoverFact[],
  months: string[],
  today: string,
): CohortRow[] =>
  months.map((month) => {
    const hires = cohortFacts(population).filter(
      (fact) => monthKey(fact.fechaIngreso!) === month,
    );

    return {
      month,
      hires: hires.length,
      smallSample: hires.length < SMALL_COHORT,
      cells: COHORT_DAYS.map((days) => {
        const retained = hires.filter((fact) =>
          isActiveOn(fact, addDays(fact.fechaIngreso!, days)),
        ).length;

        return {
          days,
          mature: addDays(monthLastDay(month), days) <= today,
          retained,
          rate: rate(retained, hires.length),
        };
      }),
    };
  });

export type TrialFunnel = {
  /** Hires of the range already past day 90 (the funnel's base). */
  hires: number;
  steps: { days: (typeof COHORT_DAYS)[number]; active: number }[];
  /** Hires of the range still inside their first 90 days (not counted). */
  inProgress: number;
  /** The 30-day stretch that loses the most people, or null. */
  biggestDrop: { from: number; to: number; lost: number } | null;
};

export const trialFunnel = (
  population: TurnoverFact[],
  from: string,
  to: string,
  today: string,
): TrialFunnel => {
  const hires = hiresIn(cohortFacts(population), from, to);
  const mature = hires.filter(
    (fact) => addDays(fact.fechaIngreso!, TRIAL_DAYS) <= today,
  );
  const steps = COHORT_DAYS.map((days) => ({
    days,
    active: mature.filter((fact) =>
      isActiveOn(fact, addDays(fact.fechaIngreso!, days)),
    ).length,
  }));
  let biggestDrop: TrialFunnel["biggestDrop"] = null;
  let previous = { days: 0, active: mature.length };

  for (const step of steps) {
    const lost = previous.active - step.active;

    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) {
      biggestDrop = { from: previous.days, to: step.days, lost };
    }

    previous = step;
  }

  return {
    hires: mature.length,
    steps,
    inProgress: hires.length - mature.length,
    biggestDrop,
  };
};

// ── Breakdowns ─────────────────────────────────────────────────────────

export type BreakdownRow = {
  /** The dimension's id; null is «Sin …»; "otros" groups the small ones. */
  key: string | null;
  headcount: number;
  exits: number;
  /** Hidden (null) for groups below MIN_GROUP_HEADCOUNT. */
  rate: number | null;
  /** Ids folded into «Otros». */
  members?: (string | null)[];
};

export const OTHERS_KEY = "otros";

const dimensionOf = (fact: TurnoverFact, dimension: TurnoverDimension) => {
  switch (dimension) {
    case "area":
      return fact.areaId;
    case "site":
      return fact.siteId;
    case "position":
      return fact.positionId;
    case "manager":
      return fact.managerId;
  }
};

/**
 * Bajas and rate per área, sucursal, puesto or jefe. Groups whose plantilla
 * is under 5 are folded into «Otros» (their rate is not shown on their own).
 */
export const breakdown = (
  population: TurnoverFact[],
  dimension: TurnoverDimension,
  from: string,
  to: string,
  isCounted: (fact: TurnoverFact) => boolean = () => true,
): BreakdownRow[] => {
  const groups = new Map<string | null, TurnoverFact[]>();

  for (const fact of population) {
    const key = dimensionOf(fact, dimension);
    const group = groups.get(key);

    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }

  const rows: BreakdownRow[] = [];
  const others: BreakdownRow = {
    key: OTHERS_KEY,
    headcount: 0,
    exits: 0,
    rate: null,
    members: [],
  };

  for (const [key, facts] of groups) {
    const headcount = rangeHeadcount(facts, from, to);
    const exits = exitsIn(facts, from, to).filter(isCounted).length;

    if (headcount === 0 && exits === 0) continue;

    if (headcount < MIN_GROUP_HEADCOUNT) {
      others.headcount += headcount;
      others.exits += exits;
      others.members!.push(key);
      continue;
    }

    rows.push({
      key,
      headcount: round(headcount),
      exits,
      rate: rate(exits, headcount),
    });
  }

  if (others.members!.length > 0) {
    others.headcount = round(others.headcount);
    others.rate =
      others.headcount >= MIN_GROUP_HEADCOUNT
        ? rate(others.exits, others.headcount)
        : null;
    rows.push(others);
  }

  return rows.sort((a, b) => b.exits - a.exits || b.headcount - a.headcount);
};

export type ReasonRow = {
  motivoId: string | null;
  name: string | null;
  classification: TerminationClassification;
  exits: number;
  share: number | null;
};

/** Bajas per motivo (no «Otros»: a motivo is not a group of people). */
export const reasonBreakdown = (exits: TurnoverFact[]): ReasonRow[] => {
  const groups = new Map<string | null, TurnoverFact[]>();

  for (const exit of exits) {
    const group = groups.get(exit.motivoId);

    if (group) group.push(exit);
    else groups.set(exit.motivoId, [exit]);
  }

  return [...groups.entries()]
    .map(([motivoId, facts]) => ({
      motivoId,
      name: facts[0].motivoName,
      classification: exitClassification(facts[0]),
      exits: facts.length,
      share: rate(facts.length, exits.length),
    }))
    .sort((a, b) => b.exits - a.exits);
};

export const TENURE_BUCKETS = [
  { key: "0-30", label: "0–30 días", max: 30 },
  { key: "31-60", label: "31–60 días", max: 60 },
  { key: "61-90", label: "61–90 días", max: 90 },
  { key: "3-6m", label: "3–6 meses", max: 182 },
  { key: "6-12m", label: "6–12 meses", max: 365 },
  { key: "1-3a", label: "1–3 años", max: 1095 },
  { key: "3a+", label: "Más de 3 años", max: Number.POSITIVE_INFINITY },
] as const;

export type TenureBucketKey = (typeof TENURE_BUCKETS)[number]["key"];

export const tenureBucketOf = (days: number): TenureBucketKey =>
  TENURE_BUCKETS.find((bucket) => days <= bucket.max)!.key;

/** How long the people who left had been in their period. */
export const tenureAtExit = (exits: TurnoverFact[]) =>
  TENURE_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    exits: exits.filter((exit) => {
      const days = daysWorked(exit);

      return days !== null && tenureBucketOf(days) === bucket.key;
    }).length,
  }));
