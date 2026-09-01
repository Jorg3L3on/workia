"use client";

import { useMemo, useState, type ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { PersonasMobileList } from "@/components/people/personas-mobile-list";
import { FormSelect } from "@/components/ui/form-select";
import { formatDateMx } from "@/lib/format/date";
import {
  matchesPersonaListRow,
  personDeletedLabel,
  personStatusLabels,
  type PersonListVisibility,
} from "@/lib/people/schema";

export type { PersonaListRow } from "@/components/people/persona-list-row";

type PersonasDataTableProps = {
  people: PersonaListRow[];
  initialSearch?: string;
  initialStatus?: "activa" | "baja" | "";
  initialVisibility?: PersonListVisibility;
  emptyAction?: ReactNode;
};

export const PersonasDataTable = ({
  people,
  initialSearch = "",
  initialStatus = "",
  initialVisibility = "expediente",
  emptyAction,
}: PersonasDataTableProps) => {
  const [status, setStatus] = useState(initialStatus);
  const [visibility, setVisibility] =
    useState<PersonListVisibility>(initialVisibility);

  const handleStatusChange = (next: string) => {
    setStatus(next as typeof initialStatus);
  };

  const handleVisibilityChange = (next: string) => {
    setVisibility(next as PersonListVisibility);
  };

  const columns = useMemo<DataTableColumn<PersonaListRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "rfc",
        header: "RFC",
        accessor: (row) => row.rfc ?? "",
        cell: (row) => (
          <span className="text-muted-foreground tabular-nums">
            {row.rfc ?? "—"}
          </span>
        ),
      },
      {
        id: "ingreso",
        header: "Ingreso",
        accessor: (row) => row.fechaIngreso ?? "",
        cell: (row) => (
          <span className="tabular-nums">{formatDateMx(row.fechaIngreso)}</span>
        ),
      },
      {
        id: "status",
        header: "Relación",
        accessor: (row) =>
          row.deleted
            ? `${personDeletedLabel} ${personStatusLabels[row.status]}`
            : personStatusLabels[row.status],
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <ListStatusBadge
              tone={row.status === "activa" ? "active" : "inactive"}
            >
              {personStatusLabels[row.status]}
            </ListStatusBadge>
            {row.deleted ? (
              <ListStatusBadge tone="destructive">
                {personDeletedLabel}
              </ListStatusBadge>
            ) : null}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Expediente",
        accessor: () => "",
        enableSorting: false,
        headerClassName: "text-right",
        cellClassName: "text-right",
        cell: (row) => (
          <ListRowAction
            aria-label={`Ver expediente de ${row.name}`}
            href={`/app/personas/${row.id}`}
          >
            Ver expediente
          </ListRowAction>
        ),
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
      filterRow={(row) => matchesPersonaListRow(row, { status, visibility })}
      getRowAriaLabel={(row) =>
        row.deleted
          ? `Ver expediente borrado de ${row.name}`
          : `Ver expediente de ${row.name}`
      }
      getRowHref={(row) => `/app/personas/${row.id}`}
      getRowId={(row) => row.id}
      getSearchText={(row) => row.searchText}
      initialSearch={initialSearch}
      noMatchesDescription={
        viewingDeleted
          ? "Los expedientes con borrado lógico aparecen aquí."
          : "Prueba con otros términos o limpia la búsqueda."
      }
      noMatchesTitle={
        viewingDeleted ? "No hay expedientes borrados" : "No hay coincidencias"
      }
      renderMobile={(visiblePeople) => (
        <PersonasMobileList people={visiblePeople} />
      )}
      resultPlural="personas"
      resultSingular="persona"
      searchPlaceholder="Buscar personas..."
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
        </div>
      }
    />
  );
};
