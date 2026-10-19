"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import { Badge } from "@/components/ui/badge";
import { activeTone } from "@/lib/ui/status-tone";

export type PlantillaListRow = {
  id: string;
  name: string;
  active: boolean;
};

type PlantillasDataTableProps = {
  templates: PlantillaListRow[];
};

export const PlantillasDataTable = ({
  templates,
}: PlantillasDataTableProps) => {
  const columns = useMemo<DataTableColumn<PlantillaListRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activa" : "Inactiva"),
        cell: (row) => (
          <Badge tone={activeTone(row.active)}>
            {row.active ? "Activa" : "Inactiva"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Acciones",
        accessor: () => "",
        enableSorting: false,
        headerClassName: "text-right",
        cellClassName: "text-right",
        cell: (row) => (
          <ListRowAction
            aria-label={`Editar plantilla ${row.name}`}
            href={`/app/contratos/plantillas/${row.id}`}
          >
            Editar
          </ListRowAction>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={templates}
      emptyDescription="Crea una plantilla para emitir contratos desde el expediente."
      emptyTitle="Sin plantillas"
      getRowAriaLabel={(row) => `Editar plantilla ${row.name}`}
      getRowHref={(row) => `/app/contratos/plantillas/${row.id}`}
      getRowId={(row) => row.id}
      resultPlural="plantillas"
      resultSingular="plantilla"
      searchPlaceholder="Buscar plantillas..."
    />
  );
};
