"use client";

import { PencilIcon } from "lucide-react";
import { useMemo } from "react";

import { catalogDeleteAction } from "@/components/catalog/catalog-row-menu";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { deleteActivityAction } from "@/lib/catalog/actions";
import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { activeTone } from "@/lib/ui/status-tone";

export type CatalogActivityRow = {
  id: string;
  name: string;
  active: boolean;
};

type CatalogActivitiesTableProps = {
  activities: CatalogActivityRow[];
  canUpdate: boolean;
  canDelete: boolean;
};

export const CatalogActivitiesTable = ({
  activities,
  canUpdate,
  canDelete,
}: CatalogActivitiesTableProps) => {
  const columns = useMemo<DataTableColumn<CatalogActivityRow>[]>(
    () => [
      {
        id: "name",
        header: "Actividad",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
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
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={activities}
      emptyTitle="Sin actividades registradas."
      getRowId={(row) => row.id}
      layout="inset"
      rowMenu={
        canUpdate || canDelete
          ? (row) => (
              <RowMenu
                actions={[
                  canUpdate && {
                    label: "Editar",
                    icon: PencilIcon,
                    href: catalogHref(CATALOG_PATHS.actividades, {
                      edit: row.id,
                    }),
                  },
                  canDelete &&
                    catalogDeleteAction(
                      deleteActivityAction.bind(null, row.id),
                      "actividad",
                      row.name,
                    ),
                ]}
                label={`Acciones de ${row.name}`}
              />
            )
          : undefined
      }
      searchPlaceholder="Buscar actividad"
    />
  );
};
