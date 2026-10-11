"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  IMPORT_COLUMNS,
  SHEET_NAMES,
  type ImportSheetKey,
} from "@/lib/import/format";

import {
  getRows,
  type JobSummary,
  type ReviewPage,
  type ReviewRow,
} from "./import-api";

export const ACTION_LABELS = {
  create: "Crear",
  update: "Actualizar",
  unchanged: "Sin cambios",
  error: "Con errores",
} as const;

type ActionFilter = keyof typeof ACTION_LABELS | "all";

const FIELD_LABELS: Record<string, string> = {
  areaId: "Área",
  positionId: "Puesto",
  siteId: "Sucursal",
  managerId: "Jefe directo",
  areaName: "Área (nueva)",
  positionName: "Puesto (nuevo)",
  siteName: "Sucursal (nueva)",
  type: "Tipo",
  endDate: "Fecha de fin",
  noticeWindow: "Aviso",
  status: "Estatus",
  salidaComer: "Salida a comer",
  regresoComer: "Regreso de comer",
  ...Object.fromEntries(
    Object.values(IMPORT_COLUMNS).flatMap((columns) =>
      columns.map((c) => [c.key, c.label]),
    ),
  ),
};

const display = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const rowLabel = (row: ReviewRow) => {
  const { raw } = row;
  const name = [raw.nombres, raw.apellidoPaterno].filter(Boolean).join(" ");

  if (row.sheet === "personas")
    return name || String(raw.curp ?? raw.idWorkia ?? "—");
  if (row.sheet === "horarios")
    return `Horario · ${raw.curp ?? raw.idWorkia ?? "—"}`;

  return `Contrato ${raw.fechaInicio ?? ""} · ${raw.curp ?? raw.idWorkia ?? "—"}`;
};

const RowDetail = ({ row }: { row: ReviewRow }) => {
  const errors = (row.errors ?? []).filter((e) => e.severity !== "warning");
  const warnings = (row.errors ?? []).filter((e) => e.severity === "warning");
  const diff = Object.entries(row.diff ?? {});

  return (
    <div className="flex flex-col gap-1">
      {errors.map((error, index) => (
        <p className="text-destructive" key={`e${index}`}>
          {error.field ? `${FIELD_LABELS[error.field] ?? error.field}: ` : ""}
          {error.message}
        </p>
      ))}
      {warnings.map((warning, index) => (
        <p className="text-muted-foreground" key={`w${index}`}>
          Aviso: {warning.message}
        </p>
      ))}
      {diff.length > 0 ? (
        <details>
          <summary className="cursor-pointer">
            {diff.length} {diff.length === 1 ? "cambio" : "cambios"}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {diff.map(([field, [before, after]]) => (
              <li key={field}>
                <span className="font-medium">
                  {FIELD_LABELS[field] ?? field}
                </span>
                :{" "}
                {field.endsWith("Id")
                  ? "cambia"
                  : `${display(before)} → ${display(after)}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {errors.length === 0 && warnings.length === 0 && diff.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : null}
    </div>
  );
};

type Props = {
  job: JobSummary;
  /** Bumped by the parent after a re-validation so the table reloads. */
  version: number;
};

/** Counters per action and a paginated, filterable table of staged rows. */
export const ImportReview = ({ job, version }: Props) => {
  const [filter, setFilter] = useState<ActionFilter>(
    (job.counts.error ?? 0) > 0 ? "error" : "all",
  );
  const [sheet, setSheet] = useState<ImportSheetKey | "all">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getRows(job.id, {
      action: filter === "all" ? undefined : filter,
      sheet: sheet === "all" ? undefined : sheet,
      page,
    })
      .then((next) => {
        if (cancelled) return;

        setLoadError(null);
        setData(next);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [job.id, filter, sheet, page, version]);

  const counts = job.counts;
  const pageCount = data
    ? Math.max(Math.ceil(data.total / data.pageSize), 1)
    : 1;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        role="group"
        aria-label="Resumen por acción"
      >
        {(Object.keys(ACTION_LABELS) as (keyof typeof ACTION_LABELS)[]).map(
          (action) => (
            <button
              aria-pressed={filter === action}
              className="bg-card ring-foreground/10 aria-pressed:ring-primary rounded-xl p-3 text-left ring-1 aria-pressed:ring-2"
              key={action}
              onClick={() => {
                setFilter(filter === action ? "all" : action);
                setPage(1);
              }}
              type="button"
            >
              <span className="text-muted-foreground block text-xs">
                {ACTION_LABELS[action]}
              </span>
              <span className="text-2xl font-semibold tabular-nums">
                {(counts[action] ?? 0).toLocaleString("es-MX")}
              </span>
            </button>
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground text-sm" htmlFor="review-sheet">
          Hoja
        </label>
        <select
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
          id="review-sheet"
          onChange={(event) => {
            setSheet(event.target.value as ImportSheetKey | "all");
            setPage(1);
          }}
          value={sheet}
        >
          <option value="all">Todas</option>
          {(Object.keys(SHEET_NAMES) as ImportSheetKey[]).map((key) => (
            <option key={key} value={key}>
              {SHEET_NAMES[key]}
            </option>
          ))}
        </select>
        {filter !== "all" ? (
          <Button
            onClick={() => setFilter("all")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Quitar filtro
          </Button>
        ) : null}
        {(counts.error ?? 0) > 0 ? (
          <Button asChild className="ml-auto" size="sm" variant="outline">
            <a download href={`/api/import/personas/${job.id}/errors`}>
              <DownloadIcon aria-hidden />
              Descargar errores
            </a>
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <p className="text-destructive text-sm" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="bg-card ring-foreground/10 overflow-x-auto rounded-xl ring-1">
        <table className="w-full text-sm">
          <caption className="sr-only">Filas de la importación</caption>
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="px-3 py-2 font-medium" scope="col">
                Hoja · fila
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Registro
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Acción
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Detalle
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr className="border-b align-top last:border-0" key={row.id}>
                <td className="px-3 py-2 whitespace-nowrap">
                  {SHEET_NAMES[row.sheet]} · {row.rowNumber}
                </td>
                <td className="px-3 py-2">{rowLabel(row)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.action === "pending"
                    ? "Pendiente"
                    : ACTION_LABELS[row.action as keyof typeof ACTION_LABELS]}
                </td>
                <td className="px-3 py-2">
                  <RowDetail row={row} />
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td
                  className="text-muted-foreground px-3 py-6 text-center"
                  colSpan={4}
                >
                  No hay filas con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground" aria-live="polite">
          {data
            ? `${data.total.toLocaleString("es-MX")} filas · página ${page} de ${pageCount}`
            : "Cargando…"}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Anterior
          </Button>
          <Button
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
};
