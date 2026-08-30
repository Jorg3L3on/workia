"use client";

import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { PersonasMobileList } from "@/components/people/personas-mobile-list";
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

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setStatus(event.target.value as typeof initialStatus);
  };

  const handleVisibilityChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setVisibility(event.target.value as PersonListVisibility);
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
      resultPlural="resultados"
      resultSingular="resultado"
      searchPlaceholder="Nombre, RFC, CURP o correo"
      toolbar={
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="space-y-2 sm:w-44">
            <label className="text-sm font-medium" htmlFor="persona-status">
              Relación
            </label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              id="persona-status"
              onChange={handleStatusChange}
              value={status}
            >
              <option value="">Todas</option>
              <option value="activa">Activas</option>
              <option value="baja">Bajas</option>
            </select>
          </div>
          <div className="space-y-2 sm:w-44">
            <label className="text-sm font-medium" htmlFor="persona-visibility">
              Expediente
            </label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              id="persona-visibility"
              onChange={handleVisibilityChange}
              value={visibility}
            >
              <option value="expediente">En expediente</option>
              <option value="deleted">Borrados</option>
            </select>
          </div>
        </div>
      }
    />
  );
};
