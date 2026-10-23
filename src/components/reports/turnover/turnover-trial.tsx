"use client";

import type { CohortRow, TrialFunnel } from "@/lib/reports/turnover/metrics";
import { cn } from "@/lib/utils";

import { formatNumber, formatRate, monthLabel, plural } from "./format";

/** «De 41 ingresos, 9 se fueron antes del día 90; la mayor caída es entre…». */
export const funnelConclusion = (funnel: TrialFunnel) => {
  if (funnel.hires === 0) {
    return funnel.inProgress > 0
      ? `${plural(funnel.inProgress, "ingreso sigue", "ingresos siguen")} dentro de sus primeros 90 días.`
      : "No hay ingresos del periodo que ya hayan cumplido 90 días.";
  }

  const lost = funnel.hires - funnel.steps.at(-1)!.active;
  const head = `De ${plural(funnel.hires, "ingreso", "ingresos")}, ${
    lost === 0
      ? "nadie se fue antes del día 90"
      : `${formatNumber(lost)} se ${lost === 1 ? "fue" : "fueron"} antes del día 90`
  }`;
  const drop = funnel.biggestDrop;
  const tail =
    drop && lost > 0
      ? `; la mayor caída es ${drop.from === 0 ? "en los primeros 30 días" : `entre el día ${drop.from} y ${drop.to}`}`
      : "";

  return `${head}${tail}.`;
};

export const TrialFunnelView = ({ funnel }: { funnel: TrialFunnel }) => {
  const steps = [
    { label: "Ingresos", active: funnel.hires },
    ...funnel.steps.map((step) => ({
      label: `Día ${step.days}`,
      active: step.active,
    })),
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm">{funnelConclusion(funnel)}</p>
      {funnel.hires > 0 ? (
        <ol className="space-y-2">
          {steps.map((step) => {
            const share = funnel.hires ? step.active / funnel.hires : 0;

            return (
              <li
                className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-sm"
                key={step.label}
              >
                <span className="text-muted-foreground">{step.label}</span>
                <span className="bg-muted h-5 overflow-hidden rounded">
                  <span
                    className="bg-chart-1/80 block h-full rounded"
                    style={{ width: `${Math.max(share * 100, 1)}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {step.active}{" "}
                  <span className="text-muted-foreground text-xs">
                    {formatRate(share * 100)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {funnel.inProgress > 0 && funnel.hires > 0 ? (
        <p className="text-muted-foreground text-xs">
          Sin contar {plural(funnel.inProgress, "ingreso", "ingresos")} que aún
          no cumple 90 días.
        </p>
      ) : null}
    </div>
  );
};

/**
 * Retention at day 30, 60 and 90 per month of hire. Color goes from the
 * surface (low) to the brand (high); immature cells are striped «en curso»
 * and cohorts under 5 hires show the count instead of a %.
 */
export const CohortHeatmap = ({
  cohorts,
  onSelect,
}: {
  cohorts: CohortRow[];
  onSelect: ((month: string) => void) | null;
}) => {
  const rows = cohorts.filter((row) => row.hires > 0);

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hubo ingresos en los últimos 12 meses.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-80 border-separate border-spacing-1 text-sm">
        <caption className="sr-only">
          Retención de cada mes de ingreso al día 30, 60 y 90
        </caption>
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="text-left font-normal" scope="col">
              Ingreso
            </th>
            <th className="text-right font-normal" scope="col">
              Altas
            </th>
            {[30, 60, 90].map((days) => (
              <th className="font-normal" key={days} scope="col">
                Día {days}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month}>
              <th
                className="text-left font-normal whitespace-nowrap"
                scope="row"
              >
                {monthLabel(row.month)}
              </th>
              <td className="text-muted-foreground text-right tabular-nums">
                {row.hires}
              </td>
              {row.cells.map((cell) => {
                const rate = cell.rate ?? 0;
                const text = row.smallSample
                  ? `${cell.retained}/${row.hires}`
                  : formatRate(cell.rate);

                return (
                  <td className="p-0" key={cell.days}>
                    <button
                      aria-label={`${monthLabel(row.month, "long")}, día ${cell.days}: ${cell.mature ? text : "en curso"}`}
                      className={cn(
                        "h-8 w-full rounded text-xs tabular-nums transition-[filter]",
                        onSelect && "hover:brightness-95",
                        !cell.mature &&
                          "text-muted-foreground bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)]",
                        cell.mature && rate >= 60 && "text-primary-foreground",
                      )}
                      disabled={!onSelect}
                      onClick={() => onSelect?.(row.month)}
                      style={
                        cell.mature
                          ? {
                              backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(15 + rate * 0.85)}%, var(--card))`,
                            }
                          : undefined
                      }
                      type="button"
                    >
                      {cell.mature ? text : "en curso"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
