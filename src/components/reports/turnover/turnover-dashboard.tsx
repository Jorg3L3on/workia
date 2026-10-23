"use client";

import {
  AlertTriangleIcon,
  ChartLineIcon,
  TagsIcon,
  UploadIcon,
  UserMinusIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CATALOG_PATHS } from "@/lib/catalog/paths";
import { peopleFilterQueryString } from "@/lib/people/filter/url";
import { monthFirstDay, monthLastDay } from "@/lib/reports/turnover/dates";
import { isTrialExit, OTHERS_KEY } from "@/lib/reports/turnover/metrics";
import { personasHrefFor } from "@/lib/reports/turnover/personas-link";
import type {
  TurnoverDetailRow,
  TurnoverReport,
} from "@/lib/reports/turnover/report";
import {
  turnoverDimensionLabels,
  type TurnoverDimension,
  type TurnoverFilter,
} from "@/lib/reports/turnover/schema";
import { turnoverHref } from "@/lib/reports/turnover/url";

import {
  TurnoverBreakdowns,
  TenureAtExit,
  type BreakdownSelection,
} from "./turnover-breakdowns";
import { TurnoverDrillDown, type DrillSelection } from "./turnover-drill-down";
import {
  TurnoverFilters,
  type TurnoverFilterOptions,
} from "./turnover-filters";
import { monthLabel, plural, rangeLabel } from "./format";
import { TurnoverKpis, type KpiDrill } from "./turnover-kpis";
import { TurnoverTrendChart } from "./turnover-trend-chart";
import { CohortHeatmap, TrialFunnelView } from "./turnover-trial";

const Section = ({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) => (
  <section
    className={`bg-card space-y-3 rounded-xl border p-4 ${className ?? ""}`}
  >
    <header>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-xs">{description}</p>
      ) : null}
    </header>
    {children}
  </section>
);

const inRange = (date: string | null, from: string, to: string) =>
  date !== null && date >= from && date <= to;

const REVIEW_HREF = `/app/personas?${peopleFilterQueryString({
  q: "",
  deleted: false,
  conditions: [
    {
      field: "revisionBaja",
      op: "is",
      values: ["sin_fecha", "inferida", "revision"],
    },
  ],
})}`;

/** Banners for data that makes the numbers less reliable. */
const QualityBanners = ({
  quality,
  canManageReasons,
}: {
  quality: TurnoverReport["quality"];
  canManageReasons: boolean;
}) => {
  const { toReview } = quality;

  return (
    <>
      {toReview > 0 || quality.sinIngreso > 0 ? (
        <Alert>
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>Hay bajas por revisar</AlertTitle>
          <AlertDescription>
            <p>
              {[
                quality.sinFecha > 0 &&
                  `${plural(quality.sinFecha, "baja sin fecha", "bajas sin fecha")} (no cuentan)`,
                quality.inferidas > 0 &&
                  plural(
                    quality.inferidas,
                    "fecha de baja inferida",
                    "fechas de baja inferidas",
                  ),
                quality.sinIngreso > 0 &&
                  plural(
                    quality.sinIngreso,
                    "periodo sin fecha de ingreso",
                    "periodos sin fecha de ingreso",
                  ),
              ]
                .filter(Boolean)
                .join(" · ")}
              . Corregirlas hace más confiable la historia.
            </p>
            {toReview > 0 ? (
              <Button asChild className="mt-2" size="sm" variant="secondary">
                <Link href={REVIEW_HREF}>Revisar ({toReview})</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {quality.unclassifiedReasons > 0 ? (
        <Alert>
          <TagsIcon aria-hidden />
          <AlertTitle>
            {plural(
              quality.unclassifiedReasons,
              "motivo sin clasificar",
              "motivos sin clasificar",
            )}
          </AlertTitle>
          <AlertDescription>
            <p>
              Cuentan como «otra» hasta que elijas si son voluntarios o
              involuntarios, así que la rotación voluntaria puede salir baja.
            </p>
            {canManageReasons ? (
              <Button asChild className="mt-2" size="sm" variant="secondary">
                <Link href={CATALOG_PATHS.motivosBaja}>Clasificar motivos</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
};

export type TurnoverDashboardProps = {
  report: TurnoverReport;
  options: TurnoverFilterOptions;
  companyId: string;
  canEditGoal: boolean;
  canManageReasons: boolean;
  canImport: boolean;
};

export const TurnoverDashboard = ({
  report,
  options,
  companyId,
  canEditGoal,
  canManageReasons,
  canImport,
}: TurnoverDashboardProps) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drill, setDrill] = useState<DrillSelection | null>(null);
  const { filter, detail } = report;
  const range = rangeLabel(filter.from, filter.to);

  const navigate = (next: TurnoverFilter) =>
    startTransition(() => router.push(turnoverHref(next), { scroll: false }));

  const exitsIn = (from: string, to: string) =>
    (detail?.exits ?? []).filter((row) => inRange(row.fechaBaja, from, to));
  const rangeExits = exitsIn(filter.from, filter.to);
  const segment = {
    tipos: filter.tipos,
    motivoIds: filter.motivoIds,
  };

  const open = (selection: DrillSelection) => setDrill(selection);

  const onKpi = (kind: KpiDrill) => {
    const base = {
      description: range,
      personasHref: personasHrefFor(filter, segment),
    };
    const byKind: Record<KpiDrill, () => DrillSelection> = {
      exits: () => ({
        ...base,
        title: "Bajas del periodo",
        kind: "exits",
        rows: rangeExits,
      }),
      trial: () => ({
        ...base,
        title: "Salidas en prueba (90 días)",
        kind: "exits",
        rows: rangeExits.filter((row) =>
          isTrialExit({ ...row, bajaSinFecha: false }),
        ),
      }),
      voluntaria: () => ({
        ...base,
        title: "Bajas voluntarias",
        kind: "exits",
        rows: rangeExits.filter((row) => row.classification === "voluntaria"),
      }),
      involuntaria: () => ({
        ...base,
        title: "Bajas involuntarias",
        kind: "exits",
        rows: rangeExits.filter((row) => row.classification === "involuntaria"),
      }),
      hires: () => ({
        ...base,
        title: "Ingresos del periodo",
        kind: "hires",
        rows: (detail?.hires ?? []).filter((row) =>
          inRange(row.fechaIngreso, filter.from, filter.to),
        ),
        personasHref: null,
      }),
    };

    open(byKind[kind]());
  };

  const onMonth = (month: string) => {
    const from = monthFirstDay(month);
    const to = monthLastDay(month);

    open({
      title: `Bajas de ${monthLabel(month, "long")}`,
      description: "Mes de la tendencia",
      kind: "exits",
      rows: exitsIn(from, to),
      personasHref: personasHrefFor({ from, to }, segment),
    });
  };

  const onCohort = (month: string) =>
    open({
      title: `Ingresos de ${monthLabel(month, "long")}`,
      description: "Cohorte: quién sigue y quién se fue",
      kind: "hires",
      rows: (detail?.hires ?? []).filter(
        (row) => row.fechaIngreso?.startsWith(month) ?? false,
      ),
      personasHref: null,
    });

  const onBreakdown = (selection: BreakdownSelection) => {
    if ("dimension" in selection) {
      const { dimension, row } = selection;
      const keys = new Set(row.key === OTHERS_KEY ? row.members : [row.key]);
      const field: Record<TurnoverDimension, keyof TurnoverDetailRow> = {
        area: "areaId",
        site: "siteId",
        position: "positionId",
        manager: "managerId",
      };

      open({
        title: `${turnoverDimensionLabels[dimension]}: ${row.label}`,
        description: range,
        kind: "exits",
        rows: rangeExits.filter((detailRow) =>
          keys.has(detailRow[field[dimension]] as string | null),
        ),
        personasHref:
          row.key && row.key !== OTHERS_KEY
            ? personasHrefFor(filter, { ...segment, dimension, key: row.key })
            : null,
      });
      return;
    }

    open({
      title: `Motivo: ${selection.label}`,
      description: range,
      kind: "exits",
      rows: rangeExits.filter((row) => row.motivoId === selection.reason),
      personasHref: selection.reason
        ? personasHrefFor(filter, {
            ...segment,
            motivoIds: [selection.reason],
          })
        : null,
    });
  };

  const canDrill = detail !== null;
  const noHistory = report.historyStart === null;

  return (
    <div className="space-y-4">
      <TurnoverFilters
        filter={filter}
        historyMonths={report.historyMonths}
        onChange={navigate}
        options={options}
        pending={pending}
        today={report.today}
      />

      <QualityBanners
        canManageReasons={canManageReasons}
        quality={report.quality}
      />

      {noHistory ? (
        <Empty className="bg-card rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartLineIcon />
            </EmptyMedia>
            <EmptyTitle>Todavía no hay bajas registradas</EmptyTitle>
            <EmptyDescription>
              La rotación se calcula con las bajas de Workia. Da de baja desde
              el expediente o carga las bajas pasadas con la importación de
              Personas (una fila por persona con su última baja) para ver la
              historia.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild variant="secondary">
              <Link href="/app/personas">
                <UserMinusIcon aria-hidden />
                Dar de baja
              </Link>
            </Button>
            {canImport ? (
              <Button asChild>
                <Link href="/app/personas/importar">
                  <UploadIcon aria-hidden />
                  Importar historial
                </Link>
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      ) : null}

      <div className={pending ? "opacity-70 transition-opacity" : undefined}>
        <TurnoverKpis
          canEditGoal={canEditGoal}
          companyId={companyId}
          onDrill={canDrill ? onKpi : null}
          report={report}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section
          description={`Bajas por mes y su tasa, últimos 12 meses hasta ${monthLabel(filter.to.slice(0, 7), "long")}`}
          title="Tendencia"
        >
          {report.historyMonths >= 3 ? (
            <TurnoverTrendChart
              onSelectMonth={canDrill ? onMonth : () => undefined}
              report={report}
            />
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {noHistory
                  ? "Sin bajas registradas: no hay tendencia que mostrar."
                  : `Hay ${plural(report.historyMonths, "mes", "meses")} de historia desde la primera baja registrada; con menos de 3 no se dibuja una tendencia.`}
              </p>
              <ul className="divide-y">
                {report.trend
                  .filter((point) => point.exits > 0)
                  .map((point) => (
                    <li
                      className="flex justify-between py-1.5"
                      key={point.month}
                    >
                      <span>{monthLabel(point.month, "long")}</span>
                      <span className="tabular-nums">
                        {plural(point.exits, "baja", "bajas")}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Section>
        <Section
          description="Ingresos del periodo que ya cumplieron 90 días"
          title="Prueba de 90 días"
        >
          <TrialFunnelView funnel={report.funnel} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section
          description={`Bajas, tasa y plantilla de ${range}`}
          title="Dónde se va la gente"
        >
          <TurnoverBreakdowns
            onSelect={canDrill ? onBreakdown : null}
            report={report}
          />
        </Section>
        <div className="space-y-4">
          <Section
            description="Retención al día 30, 60 y 90 por mes de ingreso"
            title="Cohortes"
          >
            <CohortHeatmap
              cohorts={report.cohorts}
              onSelect={canDrill ? onCohort : null}
            />
          </Section>
          <Section
            description={`Bajas de ${range} por días en el periodo`}
            title="Antigüedad al salir"
          >
            <TenureAtExit report={report} />
          </Section>
        </div>
      </div>

      <TurnoverDrillDown onClose={() => setDrill(null)} selection={drill} />
    </div>
  );
};
