"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { activeTone } from "@/lib/ui/status-tone";

export type PlantillaListRow = {
  id: string;
  name: string;
  active: boolean;
};

type PlantillasDataTableProps = {
  templates: PlantillaListRow[];
};

const PlantillaStatus = ({ row }: { row: PlantillaListRow }) => (
  <Badge tone={activeTone(row.active)}>
    {row.active ? "Activa" : "Inactiva"}
  </Badge>
);

export const PlantillasDataTable = ({
  templates,
}: PlantillasDataTableProps) => {
  const columns = useMemo<DataTableColumn<PlantillaListRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activa" : "Inactiva"),
        cell: (row) => <PlantillaStatus row={row} />,
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
      mobileCard={(row) => ({
        title: row.name,
        badge: <PlantillaStatus row={row} />,
      })}
      searchPlaceholder="Buscar plantillas..."
    />
  );
};
