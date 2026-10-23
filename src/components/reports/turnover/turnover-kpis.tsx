"use client";

import { ChevronRightIcon, InfoIcon, TargetIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setTurnoverGoalAction } from "@/lib/reports/actions";
import type { TurnoverReport } from "@/lib/reports/turnover/report";
import { cn } from "@/lib/utils";

import {
  compare,
  comparisonText,
  formatNumber,
  formatRate,
  plural,
  rangeLabel,
} from "./format";

export type Alarm = "none" | "warn" | "alert";

const alarmText: Record<Alarm, string> = {
  none: "text-foreground",
  warn: "text-amber-700 dark:text-amber-300",
  alert: "text-destructive",
};

/**
 * A KPI only takes color when it alarms (WRK-I12 design rules): red above
 * the goal, amber when it got worse than both comparisons; otherwise gray.
 */
export const alarmOf = (
  rate: number | null,
  previous: number | null | undefined,
  lastYear: number | null | undefined,
  goal: number | null,
): Alarm => {
  if (rate === null) return "none";
  if (goal !== null && rate > goal) return "alert";
  if (
    previous !== null &&
    previous !== undefined &&
    lastYear !== null &&
    lastYear !== undefined &&
    rate > previous &&
    rate > lastYear
  ) {
    return "warn";
  }

  return "none";
};

/** The formula and raw numbers behind a figure. */
export const Formula = ({ children }: { children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        aria-label="Cómo se calcula"
        className="text-muted-foreground hover:text-foreground inline-flex rounded-sm"
        type="button"
      >
        <InfoIcon aria-hidden className="size-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-72 text-left leading-relaxed">
      {children}
    </TooltipContent>
  </Tooltip>
);

const GoalControl = ({
  companyId,
  goal,
  canEdit,
}: {
  companyId: string;
  goal: number | null;
  canEdit: boolean;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (value: number | null) =>
    startTransition(async () => {
      const result = await setTurnoverGoalAction({ companyId, goal: value });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setError(null);
      setOpen(false);
      router.refresh();
    });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("goal") ?? "");
    const value = Number(raw.replace(",", "."));

    if (!raw.trim() || Number.isNaN(value)) {
      setError("Escribe la meta como porcentaje, p. ej. 2.5.");
      return;
    }

    save(value);
  };

  const label =
    goal === null ? "Sin meta" : `Meta: ${formatRate(goal)} mensual`;

  if (!canEdit) {
    return <span className="text-muted-foreground text-xs">{label}</span>;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button className="h-7 px-2 text-xs" size="sm" variant="ghost">
          <TargetIcon aria-hidden />
          {goal === null ? "Definir meta" : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="turnover-goal">Meta de rotación mensual (%)</Label>
            <Input
              defaultValue={goal ?? ""}
              id="turnover-goal"
              inputMode="decimal"
              name="goal"
              placeholder="Ej. 2.5"
            />
            <p className="text-muted-foreground text-xs">
              Se compara con la tasa mensual; un trimestre, con 3 veces la meta.
            </p>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={pending} size="sm" type="submit">
              Guardar
            </Button>
            {goal !== null ? (
              <Button
                disabled={pending}
                onClick={() => save(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Quitar meta
              </Button>
            ) : null}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};

const Card = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("bg-card flex flex-col rounded-xl border p-4", className)}>
    {children}
  </div>
);

/** «Ver personas»: opens the drill-down of a KPI. */
const DrillButton = ({
  label,
  onClick,
}: {
  label: string;
  onClick: (() => void) | undefined;
}) =>
  onClick ? (
    <Button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground mt-auto -ml-2 h-7 self-start px-2 text-xs"
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      Ver personas
      <ChevronRightIcon aria-hidden />
    </Button>
  ) : null;

export type KpiDrill =
  "exits" | "trial" | "voluntaria" | "involuntaria" | "hires";

export const TurnoverKpis = ({
  report,
  companyId,
  canEditGoal,
  onDrill,
}: {
  report: TurnoverReport;
  companyId: string;
  canEditGoal: boolean;
  onDrill: ((kind: KpiDrill) => void) | null;
}) => {
  const { summary, previous, lastYear, goal, rolling } = report;
  const heroAlarm = alarmOf(
    summary.rate,
    previous.rate,
    lastYear?.rate,
    goal.forRange,
  );
  const vsPrevious = compare(summary, previous);
  const vsLastYear = compare(summary, lastYear);
  const trialAlarm = alarmOf(
    summary.trial.share,
    previous.trial.share,
    lastYear?.trial.share,
    null,
  );
  const voluntaryAlarm = alarmOf(
    summary.byClass.voluntaria.rate,
    previous.byClass.voluntaria.rate,
    lastYear?.byClass.voluntaria.rate,
    null,
  );
  const drill = (kind: KpiDrill) => (onDrill ? () => onDrill(kind) : undefined);

  return (
    <section
      aria-label="Indicadores"
      className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
    >
      <Card className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              Rotación · {rangeLabel(summary.from, summary.to)}
              <Formula>
                Bajas del periodo / plantilla promedio × 100 ={" "}
                {formatNumber(summary.exits)} /{" "}
                {formatNumber(summary.headcount)} × 100. Plantilla de un mes =
                (activos el día 1 + activos al cierre del último día) / 2;
                varios meses, el promedio de las plantillas mensuales. Quien
                entra y sale en el mismo mes sí cuenta.
              </Formula>
            </p>
          </div>
          <GoalControl
            canEdit={canEditGoal}
            companyId={companyId}
            goal={goal.monthly}
          />
        </div>
        <p
          className={cn(
            "text-5xl font-semibold tracking-tight tabular-nums",
            alarmText[heroAlarm],
          )}
        >
          {formatRate(summary.rate)}
        </p>
        <p className="text-muted-foreground text-sm">
          {plural(summary.exits, "baja", "bajas")} · plantilla promedio{" "}
          {formatNumber(summary.headcount)}
          {summary.smallSample ? (
            <span className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">
              muestra pequeña
            </span>
          ) : null}
        </p>
        <dl className="grid gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              vs {rangeLabel(previous.from, previous.to)}
            </dt>
            <dd className="text-right tabular-nums">
              {vsPrevious ? comparisonText(vsPrevious) : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">vs un año antes</dt>
            <dd className="text-right tabular-nums">
              {vsLastYear ? comparisonText(vsLastYear) : "Sin historia"}
            </dd>
          </div>
          {goal.forRange !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Meta del periodo</dt>
              <dd
                className={cn(
                  "text-right tabular-nums",
                  heroAlarm === "alert" && "text-destructive font-medium",
                )}
              >
                {formatRate(goal.forRange)}
                {summary.rate !== null && summary.rate > goal.forRange
                  ? " · arriba de la meta"
                  : ""}
              </dd>
            </div>
          ) : null}
        </dl>
        <DrillButton
          label="Ver las bajas del periodo"
          onClick={drill("exits")}
        />
      </Card>

      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 [&>*]:min-w-56 [&>*]:snap-start md:[&>*]:min-w-0">
        <Card>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            Rotación 12 meses
            <Formula>
              Bajas de los últimos 12 meses / promedio de las 12 plantillas
              mensuales × 100 ({formatNumber(rolling.exits)} bajas).
              {rolling.estimated
                ? ` Con ${rolling.months} meses de historia es una estimación: 1 − (1 − tasa mensual promedio)^12.`
                : ""}
            </Formula>
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              alarmText[
                alarmOf(
                  rolling.rate,
                  null,
                  null,
                  goal.monthly === null ? null : goal.monthly * 12,
                )
              ],
            )}
          >
            {formatRate(rolling.rate)}
          </p>
          <p className="text-muted-foreground text-xs">
            {rolling.estimated
              ? `Estimada con ${plural(rolling.months, "mes", "meses")}`
              : rolling.rate === null
                ? "Sin bajas registradas"
                : "Últimos 12 meses"}
          </p>
        </Card>

        <Card>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            Bajas en prueba
            <Formula>
              Bajas en o antes del día 90 de su periodo (el ingreso es el día 1)
              / bajas con fecha de ingreso × 100 ={" "}
              {formatNumber(summary.trial.exits)} /{" "}
              {formatNumber(summary.trial.exitsWithIngreso)}. No renovar el
              contrato de 90 días cuenta. Por ingresos del periodo:{" "}
              {formatRate(summary.trial.ofHires)} ({summary.hires} ingresos).
            </Formula>
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              alarmText[trialAlarm],
            )}
          >
            {formatRate(summary.trial.share)}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatNumber(summary.trial.exits)} de{" "}
            {plural(summary.trial.exitsWithIngreso, "baja", "bajas")} antes del
            día 90
          </p>
          <DrillButton
            label="Ver las salidas en prueba"
            onClick={drill("trial")}
          />
        </Card>

        <Card>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            Voluntaria / involuntaria
            <Formula>
              Según la clasificación del motivo (Catálogo → Motivos de baja);
              sin motivo, según el tipo. Mismo denominador: las tres tasas suman
              la total. Otra:{" "}
              {plural(summary.byClass.otra.exits, "baja", "bajas")} (
              {formatRate(summary.byClass.otra.rate)}).
            </Formula>
          </p>
          <p className="mt-1 flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
            <span className={alarmText[voluntaryAlarm]}>
              {formatRate(summary.byClass.voluntaria.rate)}
            </span>
            <span className="text-muted-foreground text-base font-normal">
              /
            </span>
            <span>{formatRate(summary.byClass.involuntaria.rate)}</span>
          </p>
          <p className="text-muted-foreground text-xs">
            {formatNumber(summary.byClass.voluntaria.exits)} voluntarias ·{" "}
            {formatNumber(summary.byClass.involuntaria.exits)} involuntarias
          </p>
          <DrillButton
            label="Ver las bajas voluntarias"
            onClick={drill("voluntaria")}
          />
        </Card>

        <Card>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            Plantilla promedio
            <Formula>
              Promedio de (activos el día 1 + activos al cierre del último día)
              / 2 de cada mes. Ingresos del periodo: {summary.hires};
              reingresos: {summary.reentries.count}
              {summary.reentries.notRehireable > 0
                ? ` (${summary.reentries.notRehireable} marcados «no recontratable» al salir antes)`
                : ""}
              .
            </Formula>
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatNumber(summary.headcount)}
          </p>
          <p className="text-muted-foreground text-xs">
            {plural(summary.hires, "ingreso", "ingresos")} ·{" "}
            {plural(summary.reentries.count, "reingreso", "reingresos")}
          </p>
          <DrillButton
            label="Ver los ingresos del periodo"
            onClick={drill("hires")}
          />
        </Card>
      </div>
    </section>
  );
};
