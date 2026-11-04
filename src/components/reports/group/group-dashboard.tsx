"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  XIcon,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReportRow } from "@/lib/reports/absenteeism/report";
import { absenteeismHref } from "@/lib/reports/absenteeism/url";
import type { GroupDashboard as GroupDashboardData } from "@/lib/reports/group/report";
import type { GroupFilter } from "@/lib/reports/group/schema";
import { groupHref, serializeGroupFilter } from "@/lib/reports/group/url";
import { MIN_GROUP_HEADCOUNT } from "@/lib/reports/turnover/metrics";
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

/**
 * The group dashboard (W2-25): the group's numbers, then each subsidiary with
 * its regiones and sucursales. Companies start open at región level; a
 * región opens to its sucursales.
 */
export const GroupDashboard = ({
  dashboard,
  today,
  activeCompanyId,
  companyOptions,
}: {
  dashboard: GroupDashboardData;
  today: string;
  /** The company of the session: its row links to its own report. */
  activeCompanyId: string;
  companyOptions: FilterOption[];
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closedCompanies, setClosedCompanies] = useState<Set<string>>(
    new Set(),
  );
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  const { filter, total } = dashboard;
  const apply = (next: GroupFilter) =>
    startTransition(() => router.push(groupHref(next), { scroll: false }));
  const toggle = (setter: typeof setOpenRegions) => (key: string) =>
    setter((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });
  const toggleCompany = toggle(setClosedCompanies);
  const toggleRegion = toggle(setOpenRegions);
  const exportHref = (format: "xlsx" | "csv") =>
    `/app/reportes/grupo/exportar?g=${serializeGroupFilter(filter)}&format=${format}`;
  const transfers = total.transfersOut + total.transfersIn;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-busy={pending}
        aria-label="Filtros del tablero"
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
          label="Empresa"
          onChange={(companyIds) => apply({ ...filter, companyIds })}
          options={companyOptions}
          selected={filter.companyIds}
        />
        {filter.companyIds.length > 0 ? (
          <Button
            className="h-8 px-2 text-xs"
            onClick={() => apply({ ...filter, companyIds: [] })}
            size="sm"
            variant="ghost"
          >
            <XIcon aria-hidden className="size-3.5" />
            Todas las empresas
          </Button>
        ) : null}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <DownloadIcon aria-hidden />
                Exportar
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a download href={exportHref("xlsx")}>
                  <FileSpreadsheetIcon aria-hidden />
                  Excel con definiciones
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a download href={exportHref("csv")}>
                  <FileTextIcon aria-hidden />
                  CSV por empresa, región y sucursal
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section
        aria-label="Total del grupo"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Kpi
          detail={`${plural(dashboard.companies.length, "empresa", "empresas")} · ${plural(total.turnover.hires, "ingreso", "ingresos")}`}
          label="Plantilla promedio"
          value={formatNumber(total.turnover.headcount)}
        />
        <Kpi
          detail={`${plural(total.turnover.exits, "baja", "bajas")} (${formatNumber(total.turnover.voluntaryExits)} voluntarias)`}
          label="Rotación del grupo"
          value={turnoverRate(total)}
        />
        <Kpi
          detail={`${plural(total.absenteeism.absentDays, "falta", "faltas")} en ${formatNumber(total.absenteeism.presentDays + total.absenteeism.absentDays)} días · ${plural(total.absenteeism.lateDays, "día", "días")} con retardo`}
          label="Ausentismo"
          value={formatRate(total.absenteeism.rate)}
        />
        <Kpi
          detail={
            transfers > 0
              ? "Cuentan como baja e ingreso en cada empresa, no en el grupo"
              : "Sin traslados entre las empresas mostradas"
          }
          label="Traslados internos"
          value={formatNumber(total.transfersOut)}
        />
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-4">
        <header>
          <h2 className="text-sm font-semibold">
            Por empresa, región y sucursal ·{" "}
            {rangeLabel(filter.from, filter.to)}
          </h2>
          <p className="text-muted-foreground text-xs">
            Cada empresa muestra los mismos números que su reporte de Ausentismo
            y rotación. La fila del grupo se calcula con los periodos y días de
            todas, sin contar los traslados internos como bajas ni ingresos. Con
            plantilla menor a {MIN_GROUP_HEADCOUNT} no se muestra la tasa de
            rotación.
          </p>
        </header>
        {dashboard.companies.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            Ninguna de las empresas elegidas está en tu grupo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa / región / sucursal</TableHead>
                <TableHead className="text-right">Plantilla</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Bajas</TableHead>
                <TableHead className="text-right">Rotación</TableHead>
                <TableHead className="text-right">Faltas</TableHead>
                <TableHead className="text-right">Ausentismo</TableHead>
                <TableHead className="text-right">Retardos</TableHead>
                <TableHead>
                  <span className="sr-only">Reporte de la empresa</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="font-semibold">
                <TableCell>Grupo</TableCell>
                <Cells row={total} />
                <TableCell />
              </TableRow>
              {dashboard.companies.map((company) => {
                const open = !closedCompanies.has(company.companyId);

                return (
                  <Fragment key={company.companyId}>
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell>
                        <button
                          aria-expanded={open}
                          className="inline-flex items-center gap-1"
                          onClick={() => toggleCompany(company.companyId)}
                          type="button"
                        >
                          {open ? (
                            <ChevronDownIcon aria-hidden className="size-4" />
                          ) : (
                            <ChevronRightIcon aria-hidden className="size-4" />
                          )}
                          {company.companyName}
                        </button>
                        {company.transfersOut + company.transfersIn > 0 ? (
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            {plural(
                              company.transfersOut,
                              "traslado de salida",
                              "traslados de salida",
                            )}
                            ,{" "}
                            {plural(
                              company.transfersIn,
                              "de llegada",
                              "de llegada",
                            )}
                          </span>
                        ) : null}
                      </TableCell>
                      <Cells row={company.report.total} />
                      <TableCell>
                        {company.companyId === activeCompanyId ? (
                          <Link
                            className="text-primary text-xs hover:underline"
                            href={absenteeismHref({
                              from: filter.from,
                              to: filter.to,
                              regionIds: [],
                              siteIds: [],
                            })}
                          >
                            Ver reporte
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open
                      ? company.report.regions.map((region) => {
                          const regionKey = `${company.companyId}:${region.key ?? "none"}`;
                          const regionOpen = openRegions.has(regionKey);

                          return (
                            <Fragment key={regionKey}>
                              <TableRow>
                                <TableCell className="pl-8">
                                  <button
                                    aria-expanded={regionOpen}
                                    className="inline-flex items-center gap-1"
                                    onClick={() => toggleRegion(regionKey)}
                                    type="button"
                                  >
                                    {regionOpen ? (
                                      <ChevronDownIcon
                                        aria-hidden
                                        className="size-4"
                                      />
                                    ) : (
                                      <ChevronRightIcon
                                        aria-hidden
                                        className="size-4"
                                      />
                                    )}
                                    {region.label}
                                  </button>
                                </TableCell>
                                <Cells row={region} />
                                <TableCell />
                              </TableRow>
                              {regionOpen
                                ? region.sites.map((site) => (
                                    <TableRow
                                      key={`${regionKey}:${site.key ?? "none"}`}
                                    >
                                      <TableCell className="text-muted-foreground pl-16">
                                        {site.label}
                                      </TableCell>
                                      <Cells row={site} />
                                      <TableCell />
                                    </TableRow>
                                  ))
                                : null}
                            </Fragment>
                          );
                        })
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
