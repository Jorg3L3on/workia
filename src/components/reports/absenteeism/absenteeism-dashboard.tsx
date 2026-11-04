"use client";

import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import {
  MultiSelect,
  RangePicker,
  type FilterOption,
} from "@/components/reports/turnover/turnover-filters";
import {
  formatNumber,
  formatRate,
  plural,
  rangeLabel,
} from "@/components/reports/turnover/format";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AbsenteeismReport,
  ReportRow,
} from "@/lib/reports/absenteeism/report";
import type { AbsenteeismFilter } from "@/lib/reports/absenteeism/schema";
import { absenteeismHref } from "@/lib/reports/absenteeism/url";
import { MIN_GROUP_HEADCOUNT } from "@/lib/reports/turnover/metrics";
import {
  defaultTurnoverFilter,
  turnoverHref,
} from "@/lib/reports/turnover/url";
import { cn } from "@/lib/utils";

const Kpi = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="bg-card rounded-xl border p-4">
    <p className="text-muted-foreground text-xs font-medium">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
  </div>
);

const turnoverRate = (row: ReportRow) =>
  row.turnover.rate === null && row.turnover.headcount > 0
    ? "muestra pequeña"
    : formatRate(row.turnover.rate);

/** The turnover report of the same range, narrowed to the row's sucursales. */
const rotacionHref = (
  filter: AbsenteeismFilter,
  today: string,
  siteIds: string[],
) =>
  turnoverHref({
    ...defaultTurnoverFilter(today),
    from: filter.from,
    to: filter.to,
    siteIds,
  });

const Cells = ({ row }: { row: ReportRow }) => (
  <>
    <TableCell className="text-right tabular-nums">
      {formatNumber(row.turnover.headcount)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {formatNumber(row.turnover.hires)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {formatNumber(row.turnover.exits)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {turnoverRate(row)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {formatNumber(row.absenteeism.absentDays)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {formatRate(row.absenteeism.rate)}
    </TableCell>
    <TableCell className="text-right tabular-nums">
      {formatNumber(row.absenteeism.lateDays)}
    </TableCell>
  </>
);

export const AbsenteeismDashboard = ({
  report,
  today,
  options,
}: {
  report: AbsenteeismReport;
  today: string;
  options: { regions: FilterOption[]; sites: FilterOption[] };
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { filter, total } = report;
  const apply = (next: AbsenteeismFilter) =>
    startTransition(() =>
      router.push(absenteeismHref(next), { scroll: false }),
    );
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });
  const filtered = filter.regionIds.length > 0 || filter.siteIds.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-busy={pending}
        aria-label="Filtros del reporte"
        className={cn(
          "flex flex-wrap items-center gap-2",
          pending && "opacity-70",
        )}
      >
        <RangePicker
          filter={filter}
          historyMonths={12}
          onChange={(range) => apply({ ...filter, ...range })}
          today={today}
        />
        <MultiSelect
          label="Región"
          onChange={(regionIds) => apply({ ...filter, regionIds })}
          options={options.regions}
          selected={filter.regionIds}
        />
        <MultiSelect
          label="Sucursal"
          onChange={(siteIds) => apply({ ...filter, siteIds })}
          options={options.sites}
          selected={filter.siteIds}
        />
        {filtered ? (
          <Button
            className="h-8 px-2 text-xs"
            onClick={() => apply({ ...filter, regionIds: [], siteIds: [] })}
            size="sm"
            variant="ghost"
          >
            <XIcon aria-hidden className="size-3.5" />
            Limpiar filtros
          </Button>
        ) : null}
      </section>

      <section
        aria-label={filtered ? "Total de la selección" : "Total de la empresa"}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Kpi
          detail={`${plural(total.turnover.exits, "baja", "bajas")} sobre ${formatNumber(total.turnover.headcount)} de plantilla promedio`}
          label="Rotación"
          value={turnoverRate(total)}
        />
        <Kpi
          detail={`${plural(total.turnover.voluntaryExits, "baja voluntaria", "bajas voluntarias")}`}
          label="Rotación voluntaria"
          value={
            total.turnover.voluntaryRate === null
              ? "—"
              : formatRate(total.turnover.voluntaryRate)
          }
        />
        <Kpi
          detail={`${plural(total.absenteeism.absentDays, "falta", "faltas")} (${formatNumber(total.absenteeism.justifiedAbsentDays)} justificadas) en ${formatNumber(total.absenteeism.presentDays + total.absenteeism.absentDays)} días`}
          label="Ausentismo"
          value={formatRate(total.absenteeism.rate)}
        />
        <Kpi
          detail={`${formatNumber(total.absenteeism.lateMinutes)} minutos en total`}
          label="Días con retardo"
          value={formatNumber(total.absenteeism.lateDays)}
        />
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-4">
        <header>
          <h2 className="text-sm font-semibold">
            Por región y sucursal · {rangeLabel(filter.from, filter.to)}
          </h2>
          <p className="text-muted-foreground text-xs">
            Las bajas cuentan en la sucursal que tenía el periodo al darse de
            baja, como en Rotación; el ausentismo, en la sucursal actual de la
            persona. Con plantilla menor a {MIN_GROUP_HEADCOUNT} no se muestra
            la tasa de rotación.
          </p>
        </header>
        {report.regions.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            Sin sucursales con plantilla, bajas o asistencia en el periodo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Región / sucursal</TableHead>
                <TableHead className="text-right">Plantilla</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Bajas</TableHead>
                <TableHead className="text-right">Rotación</TableHead>
                <TableHead className="text-right">Faltas</TableHead>
                <TableHead className="text-right">Ausentismo</TableHead>
                <TableHead className="text-right">Retardos</TableHead>
                <TableHead>
                  <span className="sr-only">Ver en Rotación</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.regions.map((region) => {
                const regionKey = region.key ?? "none";
                const open = !collapsed.has(regionKey);
                const siteIds = region.sites
                  .map((site) => site.key)
                  .filter((key): key is string => key !== null);

                return (
                  <Fragment key={regionKey}>
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell>
                        <button
                          aria-expanded={open}
                          className="inline-flex items-center gap-1"
                          onClick={() => toggle(regionKey)}
                          type="button"
                        >
                          {open ? (
                            <ChevronDownIcon aria-hidden className="size-4" />
                          ) : (
                            <ChevronRightIcon aria-hidden className="size-4" />
                          )}
                          {region.label}
                        </button>
                      </TableCell>
                      <Cells row={region} />
                      <TableCell>
                        {siteIds.length > 0 ? (
                          <Link
                            className="text-primary text-xs hover:underline"
                            href={rotacionHref(filter, today, siteIds)}
                          >
                            Ver en Rotación
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open
                      ? region.sites.map((site) => (
                          <TableRow key={`${regionKey}:${site.key ?? "none"}`}>
                            <TableCell className="pl-8">{site.label}</TableCell>
                            <Cells row={site} />
                            <TableCell>
                              {site.key ? (
                                <Link
                                  className="text-primary text-xs hover:underline"
                                  href={rotacionHref(filter, today, [site.key])}
                                >
                                  Ver en Rotación
                                </Link>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
};
