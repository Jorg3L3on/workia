"use client";

import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { PersonasMobileList } from "@/components/people/personas-mobile-list";
import { personStatusLabels } from "@/lib/people/schema";

export type { PersonaListRow } from "@/components/people/persona-list-row";

type PersonasDataTableProps = {
  people: PersonaListRow[];
  initialSearch?: string;
  initialStatus?: "activa" | "baja" | "";
  emptyAction?: ReactNode;
};

export const PersonasDataTable = ({
  people,
  initialSearch = "",
  initialStatus = "",
  emptyAction,
}: PersonasDataTableProps) => {
  const [status, setStatus] = useState(initialStatus);

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setStatus(event.target.value as typeof initialStatus);
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
        accessor: (row) => personStatusLabels[row.status],
        cell: (row) => (
          <ListStatusBadge
            tone={row.status === "activa" ? "active" : "inactive"}
          >
            {personStatusLabels[row.status]}
          </ListStatusBadge>
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

  return (
    <DataTable
      columns={columns}
      data={people}
      emptyAction={emptyAction}
      emptyDescription={
        emptyAction
          ? "Da de alta a alguien para empezar el expediente."
          : "Cuando existan registros, los verás aquí."
      }
      emptyTitle="Aún no hay personas en el expediente"
      filterRow={status ? (row) => row.status === status : undefined}
      getRowAriaLabel={(row) => `Ver expediente de ${row.name}`}
      getRowHref={(row) => `/app/personas/${row.id}`}
      getRowId={(row) => row.id}
      getSearchText={(row) => row.searchText}
      initialSearch={initialSearch}
      renderMobile={(visiblePeople) => (
        <PersonasMobileList people={visiblePeople} />
      )}
      resultPlural="resultados"
      resultSingular="resultado"
      searchPlaceholder="Nombre, RFC, CURP o correo"
      toolbar={
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
      }
    />
  );
};
