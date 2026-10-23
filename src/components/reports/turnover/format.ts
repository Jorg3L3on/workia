import type { TurnoverSummary } from "@/lib/reports/turnover/metrics";
import { isWholeMonths, monthsBetween } from "@/lib/reports/turnover/dates";
import { formatDateMx } from "@/lib/format/date";

const percentFormat = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const numberFormat = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 1,
});

export const formatRate = (value: number | null) =>
  value === null ? "—" : `${percentFormat.format(value)} %`;

export const formatNumber = (value: number) => numberFormat.format(value);

export const plural = (count: number, one: string, many: string) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

const monthFormat = (style: "short" | "long") =>
  new Intl.DateTimeFormat("es-MX", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  });

/** «sep 2026» / «septiembre de 2026». */
export const monthLabel = (month: string, style: "short" | "long" = "short") =>
  monthFormat(style)
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(".", "")
    .replace(" de ", " ");

/** «septiembre 2026», «jul – sep 2026» or «05/03/2026 – 20/03/2026». */
export const rangeLabel = (from: string, to: string) => {
  if (isWholeMonths(from, to)) {
    const months = monthsBetween(from, to);

    if (months.length === 1) return monthLabel(months[0], "long");

    return `${monthLabel(months[0])} – ${monthLabel(months.at(-1)!)}`;
  }

  return `${formatDateMx(from)} – ${formatDateMx(to)}`;
};

export type Comparison = {
  /** Bajas more (+) or fewer (−) than the other range. */
  exits: number;
  /** Rate points of difference, or null when either has no rate. */
  points: number | null;
};

export const compare = (
  current: Pick<TurnoverSummary, "exits" | "rate">,
  other: Pick<TurnoverSummary, "exits" | "rate"> | null,
): Comparison | null =>
  other
    ? {
        exits: current.exits - other.exits,
        points:
          current.rate !== null && other.rate !== null
            ? current.rate - other.rate
            : null,
      }
    : null;

/** «▲ 1 baja · +1.6 pts», «▼ 2 bajas · −3.1 pts» or «= igual». */
export const comparisonText = (comparison: Comparison) => {
  const { exits, points } = comparison;
  const arrow = exits > 0 ? "▲" : exits < 0 ? "▼" : "=";
  const count =
    exits === 0
      ? "mismas bajas"
      : `${arrow} ${plural(Math.abs(exits), "baja", "bajas")}`;
  const pts =
    points === null || Math.abs(points) < 0.05
      ? null
      : `${points > 0 ? "+" : "−"}${percentFormat.format(Math.abs(points))} pts`;

  return [count, pts].filter(Boolean).join(" · ");
};
