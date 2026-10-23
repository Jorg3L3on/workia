"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { TurnoverReport } from "@/lib/reports/turnover/report";

import { formatNumber, formatRate, monthLabel, plural } from "./format";

type Point = {
  month: string;
  label: string;
  voluntaria: number;
  involuntaria: number;
  otra: number;
  exits: number;
  rate: number | null;
  lastYearRate: number | null;
  average: number;
  dailyAverage: number;
  hasHistory: boolean;
};

const TrendTooltip = ({
  active,
  payload,
}: Partial<TooltipContentProps<number, string>>) => {
  const point = payload?.[0]?.payload as Point | undefined;

  if (!active || !point) return null;

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{monthLabel(point.month, "long")}</p>
      {point.hasHistory ? (
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-muted-foreground">Rotación</dt>
          <dd className="text-right">{formatRate(point.rate)}</dd>
          <dt className="text-muted-foreground">Bajas</dt>
          <dd className="text-right">{point.exits}</dd>
          <dt className="text-muted-foreground pl-2">voluntarias</dt>
          <dd className="text-right">{point.voluntaria}</dd>
          <dt className="text-muted-foreground pl-2">involuntarias</dt>
          <dd className="text-right">{point.involuntaria}</dd>
          <dt className="text-muted-foreground pl-2">otras</dt>
          <dd className="text-right">{point.otra}</dd>
          <dt className="text-muted-foreground">Plantilla</dt>
          <dd className="text-right">{formatNumber(point.average)}</dd>
          <dt className="text-muted-foreground">Promedio diario</dt>
          <dd className="text-right">{formatNumber(point.dailyAverage)}</dd>
          <dt className="text-muted-foreground">Un año antes</dt>
          <dd className="text-right">{formatRate(point.lastYearRate)}</dd>
        </dl>
      ) : (
        <p className="text-muted-foreground">Sin bajas registradas todavía.</p>
      )}
    </div>
  );
};

/**
 * Monthly bajas (bars, by classification) and rate (line) of the last 12
 * months, the same months a year before (dashed) and the goal, if any.
 * Months before the first recorded baja are drawn as «sin historia».
 */
export const TurnoverTrendChart = ({
  report,
  onSelectMonth,
}: {
  report: TurnoverReport;
  onSelectMonth: (month: string) => void;
}) => {
  const data: Point[] = report.trend.map((point, index) => {
    const hasHistory =
      report.historyStart !== null && point.month >= report.historyStart;
    const lastYear = report.trendLastYear[index];

    return {
      month: point.month,
      label: monthLabel(point.month),
      ...point.byClass,
      exits: point.exits,
      rate: hasHistory ? point.rate : null,
      lastYearRate:
        report.historyStart !== null && lastYear.month >= report.historyStart
          ? lastYear.rate
          : null,
      average: point.average,
      dailyAverage: point.dailyAverage,
      hasHistory,
    };
  });
  const hasLastYear = data.some((point) => point.lastYearRate !== null);
  const totalExits = data.reduce((sum, point) => sum + point.exits, 0);

  return (
    <figure className="space-y-2">
      <div className="h-64 w-full">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 4, bottom: 0, left: -12 }}
            onClick={(state) => {
              const index = Number(state?.activeTooltipIndex);

              if (Number.isInteger(index) && data[index]) {
                onSelectMonth(data[index].month);
              }
            }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              fontSize={11}
              interval="preserveStartEnd"
              stroke="var(--muted-foreground)"
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              fontSize={11}
              stroke="var(--muted-foreground)"
              tickLine={false}
              width={36}
              yAxisId="exits"
            />
            <YAxis
              axisLine={false}
              fontSize={11}
              orientation="right"
              stroke="var(--muted-foreground)"
              tickFormatter={(value: number) => `${value}%`}
              tickLine={false}
              width={40}
              yAxisId="rate"
            />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            />
            <Bar
              dataKey="voluntaria"
              fill="var(--chart-3)"
              stackId="exits"
              yAxisId="exits"
            />
            <Bar
              dataKey="involuntaria"
              fill="var(--chart-4)"
              stackId="exits"
              yAxisId="exits"
            />
            <Bar
              dataKey="otra"
              fill="var(--border)"
              radius={[3, 3, 0, 0]}
              stackId="exits"
              yAxisId="exits"
            />
            {hasLastYear ? (
              <Line
                connectNulls
                dataKey="lastYearRate"
                dot={false}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="rate"
              />
            ) : null}
            <Line
              dataKey="rate"
              dot={{ r: 2.5, fill: "var(--chart-1)" }}
              stroke="var(--chart-1)"
              strokeWidth={2}
              type="monotone"
              yAxisId="rate"
            />
            {report.goal.monthly !== null ? (
              <ReferenceLine
                ifOverflow="extendDomain"
                label={{
                  value: `Meta ${formatRate(report.goal.monthly)}`,
                  position: "insideTopRight",
                  fontSize: 11,
                  fill: "var(--destructive)",
                }}
                stroke="var(--destructive)"
                strokeDasharray="6 4"
                y={report.goal.monthly}
                yAxisId="rate"
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-chart-1 h-0.5 w-4 rounded" /> Rotación mensual
        </span>
        {hasLastYear ? (
          <span className="flex items-center gap-1.5">
            <span className="border-muted-foreground w-4 border-t-2 border-dashed" />
            Un año antes
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <span className="bg-chart-3 size-2.5 rounded-sm" /> Voluntarias
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-chart-4 size-2.5 rounded-sm" /> Involuntarias
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-border size-2.5 rounded-sm" /> Otras
        </span>
        <span className="sm:ml-auto">
          {plural(totalExits, "baja", "bajas")} en 12 meses · clic en un mes
          para verlo
        </span>
      </figcaption>
    </figure>
  );
};
