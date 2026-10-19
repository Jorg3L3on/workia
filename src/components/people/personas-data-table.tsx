"use client";

import { useMemo, type ReactNode } from "react";

import { FileTextIcon, PencilIcon } from "lucide-react";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { FormSelect } from "@/components/ui/form-select";
import { formatDateMx } from "@/lib/format/date";
import {
  personDeletedLabel,
  personStatusLabels,
  type PersonListVisibility,
} from "@/lib/people/schema";
import { deletedTone, toneFor } from "@/lib/ui/status-tone";

export type { PersonaListRow } from "@/components/people/persona-list-row";

type PersonasDataTableProps = {
  people: PersonaListRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  status: "activa" | "baja" | "";
  visibility: PersonListVisibility;
  emptyAction?: ReactNode;
  /** Region filter (WRK-I5-4); hidden when the company has no regions. */
  region?: string;
  regions?: { id: string; name: string }[];
  /** Row menu: «Editar» and «Constancia de antigüedad». */
  canUpdate?: boolean;
  canReadContracts?: boolean;
};

const PersonStatus = ({ row }: { row: PersonaListRow }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <Badge tone={toneFor("person", row.status)}>
      {personStatusLabels[row.status]}
    </Badge>
    {row.deleted ? (
      <Badge tone={deletedTone}>{personDeletedLabel}</Badge>
    ) : null}
  </div>
);

export const PersonasDataTable = ({
  people,
  total,
  page,
  pageSize,
  query,
  status,
  visibility,
  emptyAction,
  region = "",
  regions = [],
  canUpdate = false,
  canReadContracts = false,
}: PersonasDataTableProps) => {
  const controls = useServerListControls();

  const handleRegionChange = (next: string) => {
    controls.setFilter("region", next || null);
  };

  const handleStatusChange = (next: string) => {
    controls.setFilter("status", next || null);
  };

  const handleVisibilityChange = (next: string) => {
    controls.setFilter("deleted", next === "deleted" ? "1" : null);
  };

  const columns = useMemo<DataTableColumn<PersonaListRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "rfc",
        header: "RFC",
        accessor: (row) => row.rfc ?? "",
        variant: "muted",
      },
      {
        id: "ingreso",
        header: "Ingreso",
        accessor: (row) => row.fechaIngreso ?? "",
        variant: "muted",
      },
      {
        id: "status",
        header: "Relación",
        accessor: (row) =>
          row.deleted
            ? `${personDeletedLabel} ${personStatusLabels[row.status]}`
            : personStatusLabels[row.status],
        cell: (row) => <PersonStatus row={row} />,
      },
    ],
    [],
  );

  const viewingDeleted = visibility === "deleted";

  return (
    <DataTable
      columns={columns}
      data={people}
      emptyAction={viewingDeleted ? undefined : emptyAction}
      emptyDescription={
        viewingDeleted
          ? "Los expedientes con borrado lógico aparecen aquí."
          : emptyAction
            ? "Da de alta a alguien para empezar el expediente."
            : "Cuando existan registros, los verás aquí."
      }
      emptyTitle={
        viewingDeleted
          ? "No hay expedientes borrados"
          : "Aún no hay personas en el expediente"
      }
      getRowAriaLabel={(row) =>
        row.deleted
          ? `Ver expediente borrado de ${row.name}`
          : `Ver expediente de ${row.name}`
      }
      getRowHref={(row) => `/app/personas/${row.id}`}
      getRowId={(row) => row.id}
      noMatchesDescription={
        viewingDeleted
          ? "Los expedientes con borrado lógico aparecen aquí."
          : "Prueba con otros términos o limpia la búsqueda."
      }
      noMatchesTitle={
        viewingDeleted ? "No hay expedientes borrados" : "No hay coincidencias"
      }
      mobileCard={(row) => ({
        title: row.name,
        subtitle: [row.rfc, formatDateMx(row.fechaIngreso)]
          .filter((value) => value && value !== "—")
          .join(" · "),
        badge: <PersonStatus row={row} />,
      })}
      pageSizes={controls.pageSizes}
      rowMenu={(row) =>
        row.deleted || (!canUpdate && !canReadContracts) ? null : (
          <RowMenu
            actions={[
              canUpdate && {
                label: "Editar",
                icon: PencilIcon,
                href: `/app/personas/${row.id}?edit=1`,
              },
              canReadContracts && {
                label: "Constancia de antigüedad",
                icon: FileTextIcon,
                href: `/app/personas/${row.id}/constancia`,
              },
            ]}
            label={`Acciones de ${row.name}`}
          />
        )
      }
      rowTestId="persona-row"
      searchPlaceholder="Buscar por nombre, RFC o CURP..."
      server={{
        total,
        page,
        pageSize,
        query,
        hasFilters: Boolean(query || status || region),
        onQueryChange: controls.setQuery,
        onPageChange: controls.setPage,
        onPageSizeChange: controls.setPageSize,
      }}
      toolbar={
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-48">
            <label className="sr-only" htmlFor="persona-status">
              Relación
            </label>
            <FormSelect
              aria-label="Relación"
              id="persona-status"
              onValueChange={handleStatusChange}
              options={[
                { value: "", label: "Todos los estados" },
                { value: "activa", label: "Activas" },
                { value: "baja", label: "Bajas" },
              ]}
              value={status}
            />
          </div>
          <div className="sm:w-48">
            <label className="sr-only" htmlFor="persona-visibility">
              Expediente
            </label>
            <FormSelect
              aria-label="Expediente"
              id="persona-visibility"
              onValueChange={handleVisibilityChange}
              options={[
                { value: "expediente", label: "En expediente" },
                { value: "deleted", label: "Borrados" },
              ]}
              value={visibility}
            />
          </div>
          {regions.length > 0 ? (
            <div className="sm:w-48">
              <label className="sr-only" htmlFor="persona-region">
                Región
              </label>
              <FormSelect
                aria-label="Región"
                id="persona-region"
                onValueChange={handleRegionChange}
                options={[
                  { value: "", label: "Todas las regiones" },
                  ...regions.map((option) => ({
                    value: option.id,
                    label: option.name,
                  })),
                ]}
                value={region}
              />
            </div>
          ) : null}
        </div>
      }
    />
  );
};
