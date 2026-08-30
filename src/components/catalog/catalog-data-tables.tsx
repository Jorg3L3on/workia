"use client";

import { useMemo } from "react";

import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import { deletePositionAction } from "@/lib/catalog/actions";
import { deleteSiteAction } from "@/lib/sites/actions";

export type CatalogPositionRow = {
  id: string;
  name: string;
  areaName: string;
  active: boolean;
};

export type CatalogSiteRow = {
  id: string;
  name: string;
  kindLabel: string;
};

type CatalogPositionsTableProps = {
  positions: CatalogPositionRow[];
  canDelete: boolean;
};

type CatalogSitesTableProps = {
  sites: CatalogSiteRow[];
  canDelete: boolean;
};

export const CatalogPositionsTable = ({
  positions,
  canDelete,
}: CatalogPositionsTableProps) => {
  const columns = useMemo<DataTableColumn<CatalogPositionRow>[]>(
    () => [
      {
        id: "name",
        header: "Puesto",
        accessor: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "area",
        header: "Área",
        accessor: (row) => row.areaName,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activo" : "Inactivo"),
        cell: (row) =>
          row.active ? (
            <ListStatusBadge tone="active">Activo</ListStatusBadge>
          ) : (
            <ListStatusBadge tone="inactive">Inactivo</ListStatusBadge>
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
              cell: (row: CatalogPositionRow) => (
                <CatalogRowDeleteButton
                  action={deletePositionAction.bind(null, row.id)}
                  itemLabel="puesto"
                  itemName={row.name}
                />
              ),
            } satisfies DataTableColumn<CatalogPositionRow>,
          ]
        : []),
    ],
    [canDelete],
  );

  return (
    <DataTable
      columns={columns}
      data={positions}
      emptyTitle="Sin puestos registrados."
      getRowId={(row) => row.id}
      layout="inset"
      resultPlural="puestos"
      resultSingular="puesto"
      searchPlaceholder="Buscar puesto o área"
    />
  );
};

export const CatalogSitesTable = ({
  sites,
  canDelete,
}: CatalogSitesTableProps) => {
  const columns = useMemo<DataTableColumn<CatalogSiteRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "kind",
        header: "Tipo",
        accessor: (row) => row.kindLabel,
      },
      {
        id: "status",
        header: "Estado",
        accessor: () => "Activa",
        cell: () => <ListStatusBadge tone="active">Activa</ListStatusBadge>,
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
              cell: (row: CatalogSiteRow) => (
                <CatalogRowDeleteButton
                  action={deleteSiteAction.bind(null, row.id)}
                  itemLabel="sucursal"
                  itemName={row.name}
                />
              ),
            } satisfies DataTableColumn<CatalogSiteRow>,
          ]
        : []),
    ],
    [canDelete],
  );

  return (
    <DataTable
      columns={columns}
      data={sites}
      emptyTitle="Sin sucursales registradas."
      getRowId={(row) => row.id}
      layout="inset"
      resultPlural="sucursales"
      resultSingular="sucursal"
      searchPlaceholder="Buscar sucursal"
    />
  );
};
