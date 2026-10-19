"use client";

import { useMemo } from "react";

import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyField } from "@/components/tenant/company-context";
import { deleteRegionAction, updateRegionAction } from "@/lib/regions/actions";
import { activeTone } from "@/lib/ui/status-tone";

export type CatalogRegionRow = {
  id: string;
  name: string;
  active: boolean;
  siteCount: number;
};

type CatalogRegionsTableProps = {
  regions: CatalogRegionRow[];
  canUpdate: boolean;
  canDelete: boolean;
};

/** Regions over sites (WRK-I5-4): rename, activate or deactivate in place. */
export const CatalogRegionsTable = ({
  regions,
  canUpdate,
  canDelete,
}: CatalogRegionsTableProps) => {
  const columns = useMemo<DataTableColumn<CatalogRegionRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        cell: (row) =>
          canUpdate ? (
            <form
              action={updateRegionAction.bind(null, row.id)}
              className="flex flex-wrap items-center gap-2"
            >
              <CompanyField />
              <input
                name="active"
                type="hidden"
                value={row.active ? "true" : "false"}
              />
              <Input
                aria-label={`Nombre de ${row.name}`}
                className="h-8 w-48"
                defaultValue={row.name}
                name="name"
                required
              />
              <Button size="sm" type="submit" variant="ghost">
                Guardar
              </Button>
            </form>
          ) : (
            <span className="font-medium">{row.name}</span>
          ),
      },
      {
        id: "sites",
        header: "Sucursales",
        accessor: (row) => row.siteCount,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activa" : "Inactiva"),
        cell: (row) =>
          canUpdate ? (
            <form
              action={updateRegionAction.bind(null, row.id)}
              className="flex items-center gap-2"
            >
              <CompanyField />
              <input name="name" type="hidden" value={row.name} />
              <input
                name="active"
                type="hidden"
                value={row.active ? "false" : "true"}
              />
              <Badge tone={activeTone(row.active)}>
                {row.active ? "Activa" : "Inactiva"}
              </Badge>
              <Button size="sm" type="submit" variant="ghost">
                {row.active ? "Desactivar" : "Activar"}
              </Button>
            </form>
          ) : (
            <Badge tone={activeTone(row.active)}>
              {row.active ? "Activa" : "Inactiva"}
            </Badge>
          ),
      },
      ...(canDelete
        ? [
            {
              id: "actions",
              header: "",
              accessor: () => "",
              enableSorting: false,
              headerClassName: "text-right",
              cellClassName: "text-right",
              cell: (row: CatalogRegionRow) => (
                <CatalogRowDeleteButton
                  action={deleteRegionAction.bind(null, row.id)}
                  itemLabel="región"
                  itemName={row.name}
                />
              ),
            } satisfies DataTableColumn<CatalogRegionRow>,
          ]
        : []),
    ],
    [canUpdate, canDelete],
  );

  return (
    <DataTable
      columns={columns}
      data={regions}
      emptyTitle="Sin regiones registradas."
      getRowId={(row) => row.id}
      layout="inset"
      resultPlural="regiones"
      resultSingular="región"
      searchPlaceholder="Buscar región"
    />
  );
};
