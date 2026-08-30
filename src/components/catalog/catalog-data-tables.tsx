"use client";

import { useMemo } from "react";

import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import { Button } from "@/components/ui/button";
import {
  deletePositionAction,
  unassignActivityFromPositionAction,
} from "@/lib/catalog/actions";
import { deleteSiteAction } from "@/lib/sites/actions";

export type CatalogPositionActivity = {
  id: string;
  name: string;
};

export type CatalogPositionRow = {
  id: string;
  name: string;
  areaName: string;
  active: boolean;
  activities: CatalogPositionActivity[];
};

export type CatalogSiteRow = {
  id: string;
  name: string;
  kindLabel: string;
};

type CatalogPositionsTableProps = {
  positions: CatalogPositionRow[];
  canDelete: boolean;
  canAssign: boolean;
};

type CatalogSitesTableProps = {
  sites: CatalogSiteRow[];
  canDelete: boolean;
};

export const CatalogPositionsTable = ({
  positions,
  canDelete,
  canAssign,
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
        id: "activities",
        header: "Actividades",
        accessor: (row) =>
          row.activities.map((activity) => activity.name).join(" "),
        cell: (row) =>
          row.activities.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="space-y-1">
              {row.activities.map((activity) => (
                <li
                  className="flex flex-wrap items-center gap-2"
                  key={activity.id}
                >
                  <span>{activity.name}</span>
                  {canAssign ? (
                    <form action={unassignActivityFromPositionAction}>
                      <input name="positionId" type="hidden" value={row.id} />
                      <input
                        name="activityId"
                        type="hidden"
                        value={activity.id}
                      />
                      <Button
                        aria-label={`Quitar ${activity.name} de ${row.name}`}
                        size="sm"
                        type="submit"
                        variant="ghost"
                      >
                        Quitar
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ),
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
    [canAssign, canDelete],
  );

  return (
    <DataTable
      columns={columns}
      data={positions}
      emptyTitle="Sin puestos registrados."
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        [row.name, row.areaName, ...row.activities.map((item) => item.name)]
          .filter(Boolean)
          .join(" ")
      }
      layout="inset"
      resultPlural="puestos"
      resultSingular="puesto"
      searchPlaceholder="Buscar puesto, área o actividad"
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
