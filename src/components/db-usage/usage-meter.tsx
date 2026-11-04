import { Badge } from "@/components/ui/badge";
import {
  formatPercent,
  type UsageLevel,
  type UsageMetric,
} from "@/lib/db-usage/limits";
import type { Tone } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

export const usageTone: Record<UsageLevel, Tone> = {
  ok: "success",
  warn: "warning",
  critical: "danger",
};

export const usageLevelLabel: Record<UsageLevel, string> = {
  ok: "Dentro del límite",
  warn: "Cerca del límite",
  critical: "En el límite",
};

const fill: Record<UsageLevel, string> = {
  ok: "bg-primary",
  warn: "bg-amber-500 dark:bg-amber-400",
  critical: "bg-destructive",
};

/** One Free limit: label, how much is used of it, and a horizontal meter. */
export const UsageMeter = ({ metric }: { metric: UsageMetric }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm font-medium">{metric.label}</span>
      <Badge tone={usageTone[metric.level]}>
        {formatPercent(metric.ratio)}
      </Badge>
    </div>
    <div
      role="meter"
      aria-label={metric.label}
      aria-valuemin={0}
      aria-valuemax={metric.limit}
      aria-valuenow={Math.min(metric.used, metric.limit)}
      aria-valuetext={metric.summary}
      className="bg-muted h-2 overflow-hidden rounded-full"
    >
      <div
        className={cn("h-full rounded-full", fill[metric.level])}
        style={{ width: `${Math.min(metric.ratio, 1) * 100}%` }}
      />
    </div>
    <p className="text-muted-foreground text-xs tabular-nums">
      {metric.summary}
    </p>
  </div>
);
