"use client";

import { useMemo } from "react";
import Link from "next/link";

import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import { Button } from "@/components/ui/button";
import { deleteActivityAction } from "@/lib/catalog/actions";
import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";

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
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activa" : "Inactiva"),
        cell: (row) =>
          row.active ? (
            <ListStatusBadge tone="active">Activa</ListStatusBadge>
          ) : (
            <ListStatusBadge tone="inactive">Inactiva</ListStatusBadge>
          ),
      },
      ...(canUpdate || canDelete
        ? [
            {
              id: "actions",
              header: "",
              accessor: () => "",
              enableSorting: false,
              headerClassName: "text-right",
              cellClassName: "text-right",
              cell: (row: CatalogActivityRow) => (
                <div className="flex justify-end gap-1">
                  {canUpdate ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        aria-label={`Editar actividad ${row.name}`}
                        href={catalogHref(CATALOG_PATHS.actividades, {
                          edit: row.id,
                        })}
                      >
                        Editar
                      </Link>
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <CatalogRowDeleteButton
                      action={deleteActivityAction.bind(null, row.id)}
                      itemLabel="actividad"
                      itemName={row.name}
                    />
                  ) : null}
                </div>
              ),
            } satisfies DataTableColumn<CatalogActivityRow>,
          ]
        : []),
    ],
    [canDelete, canUpdate],
  );

  return (
    <DataTable
      columns={columns}
      data={activities}
      emptyTitle="Sin actividades registradas."
      getRowId={(row) => row.id}
      layout="inset"
      resultPlural="actividades"
      resultSingular="actividad"
      searchPlaceholder="Buscar actividad"
    />
  );
};
