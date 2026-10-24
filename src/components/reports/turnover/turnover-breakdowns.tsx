"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MIN_GROUP_HEADCOUNT } from "@/lib/reports/turnover/metrics";
import type {
  LabeledBreakdownRow,
  TurnoverReport,
} from "@/lib/reports/turnover/report";
import {
  TURNOVER_DIMENSIONS,
  turnoverDimensionLabels,
  type TurnoverDimension,
} from "@/lib/reports/turnover/schema";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";
import { cn } from "@/lib/utils";

import { formatNumber, formatRate, plural } from "./format";

type Sort = "rate" | "exits";

export type BreakdownSelection =
  | { dimension: TurnoverDimension; row: LabeledBreakdownRow }
  | { reason: string | null; label: string };

/**
 * Red only above the threshold: the goal for the range, or with no goal the
 * company's rate + 50 %.
 */
const thresholdOf = (report: TurnoverReport) =>
  report.goal.forRange ??
  (report.summary.rate === null ? null : report.summary.rate * 1.5);

const Bars = ({
  rows,
  sort,
  threshold,
  onSelect,
}: {
  rows: LabeledBreakdownRow[];
  sort: Sort;
  threshold: number | null;
  onSelect: ((row: LabeledBreakdownRow) => void) | null;
}) => {
  const sorted = [...rows].sort((a, b) =>
    sort === "rate"
      ? (b.rate ?? -1) - (a.rate ?? -1) || b.exits - a.exits
      : b.exits - a.exits || (b.rate ?? -1) - (a.rate ?? -1),
  );
  const max = Math.max(
    ...sorted.map((row) => (sort === "rate" ? (row.rate ?? 0) : row.exits)),
    1,
  );

  if (sorted.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">
        Sin bajas ni plantilla en el periodo.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {sorted.map((row) => {
        const value = sort === "rate" ? (row.rate ?? 0) : row.exits;
        const hot =
          threshold !== null && row.rate !== null && row.rate > threshold;

        return (
          <li key={row.key ?? "none"}>
            <button
              className={cn(
                "grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left text-sm",
                onSelect ? "hover:bg-muted" : "cursor-default",
              )}
              disabled={!onSelect || row.exits === 0}
              onClick={() => onSelect?.(row)}
              type="button"
            >
              <span className="truncate" title={row.label}>
                {row.label}
              </span>
              <span className="bg-muted h-4 overflow-hidden rounded">
                <span
                  className={cn(
                    "block h-full rounded",
                    hot ? "bg-destructive/80" : "bg-chart-3/70",
                  )}
                  style={{ width: `${Math.max((value / max) * 100, 1.5)}%` }}
                />
              </span>
              <span className="min-w-28 text-right tabular-nums">
                <span className={cn(hot && "text-destructive font-medium")}>
                  {row.rate === null ? "—" : formatRate(row.rate)}
                </span>{" "}
                <span className="text-muted-foreground text-xs">
                  {plural(row.exits, "baja", "bajas")} ·{" "}
                  {formatNumber(row.headcount)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export const TurnoverBreakdowns = ({
  report,
  onSelect,
}: {
  report: TurnoverReport;
  onSelect: ((selection: BreakdownSelection) => void) | null;
}) => {
  const [sort, setSort] = useState<Sort>("exits");
  const threshold = thresholdOf(report);
  const totalExits = report.summary.exits;

  return (
    <Tabs defaultValue="area">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          {TURNOVER_DIMENSIONS.map((dimension) => (
            <TabsTrigger key={dimension} value={dimension}>
              {turnoverDimensionLabels[dimension]}
            </TabsTrigger>
          ))}
          <TabsTrigger value="motivo">Motivo</TabsTrigger>
        </TabsList>
        <div
          aria-label="Ordenar"
          className="bg-muted flex rounded-md p-0.5"
          role="group"
        >
          {(["exits", "rate"] as const).map((option) => (
            <Button
              aria-pressed={sort === option}
              className={cn(
                "h-7 px-2.5 text-xs",
                sort === option
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground",
              )}
              key={option}
              onClick={() => setSort(option)}
              size="sm"
              variant="ghost"
            >
              {option === "exits" ? "Por bajas" : "Por tasa"}
            </Button>
          ))}
        </div>
      </div>
      {TURNOVER_DIMENSIONS.map((dimension) => (
        <TabsContent className="pt-3" key={dimension} value={dimension}>
          <Bars
            onSelect={onSelect ? (row) => onSelect({ dimension, row }) : null}
            rows={report.breakdowns[dimension]}
            sort={sort}
            threshold={threshold}
          />
          <p className="text-muted-foreground mt-2 text-xs">
            Tasa · bajas · plantilla promedio. Los grupos con menos de{" "}
            {MIN_GROUP_HEADCOUNT} personas se juntan en «Otros».
            {threshold !== null
              ? ` En rojo, arriba de ${formatRate(threshold)} (${report.goal.forRange !== null ? "la meta" : "promedio de la empresa + 50 %"}).`
              : ""}
          </p>
        </TabsContent>
      ))}
      <TabsContent className="pt-3" value="motivo">
        {report.reasons.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            Sin bajas en el periodo.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {report.reasons.map((reason) => (
              <li key={reason.motivoId ?? "none"}>
                <button
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left text-sm",
                    onSelect ? "hover:bg-muted" : "cursor-default",
                  )}
                  disabled={!onSelect}
                  onClick={() =>
                    onSelect?.({
                      reason: reason.motivoId,
                      label: reason.name ?? "Sin motivo",
                    })
                  }
                  type="button"
                >
                  <span className="truncate" title={reason.name ?? undefined}>
                    {reason.name ?? "Sin motivo"}
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {terminationClassificationLabels[reason.classification]}
                    </span>
                  </span>
                  <span className="bg-muted h-4 overflow-hidden rounded">
                    <span
                      className="bg-chart-3/70 block h-full rounded"
                      style={{
                        width: `${(reason.exits / Math.max(totalExits, 1)) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="min-w-24 text-right tabular-nums">
                    {reason.exits}{" "}
                    <span className="text-muted-foreground text-xs">
                      {formatRate(reason.share)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
};

/** How long the people who left had been in their period. */
export const TenureAtExit = ({ report }: { report: TurnoverReport }) => {
  const max = Math.max(...report.tenure.map((bucket) => bucket.exits), 1);
  const { meanDays, medianDays } = report.summary.tenure;

  return (
    <div className="space-y-3">
      <div className="flex h-32 items-end gap-1.5">
        {report.tenure.map((bucket) => (
          <div
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            key={bucket.key}
          >
            <span className="text-xs tabular-nums">{bucket.exits || ""}</span>
            <span
              className={cn(
                "w-full rounded-t",
                bucket.key === "0-30" ||
                  bucket.key === "31-60" ||
                  bucket.key === "61-90"
                  ? "bg-chart-1/70"
                  : "bg-chart-3/60",
              )}
              style={{ height: `${(bucket.exits / max) * 100}%`, minHeight: 2 }}
              title={`${bucket.label}: ${bucket.exits}`}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex gap-1.5 text-[0.65rem] leading-tight">
        {report.tenure.map((bucket) => (
          <span className="flex-1 text-center" key={bucket.key}>
            {bucket.label}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {meanDays === null
          ? "Sin bajas con fecha de ingreso."
          : `Promedio ${formatNumber(meanDays)} días · mediana ${formatNumber(medianDays ?? 0)} días. Los primeros tres grupos son la prueba de 90 días.`}
      </p>
    </div>
  );
};
