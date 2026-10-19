"use client";

import { MapPinIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  CatalogEditDialog,
  catalogDeleteAction,
} from "@/components/catalog/catalog-row-menu";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  EmptyValue,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  deletePositionAction,
  unassignActivityFromPositionAction,
} from "@/lib/catalog/actions";
import { deleteSiteAction, setSiteRegionAction } from "@/lib/sites/actions";
import { FormSelect } from "@/components/ui/form-select";
import { CompanyField } from "@/components/tenant/company-context";
import { activeTone } from "@/lib/ui/status-tone";

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
  regionId: string | null;
  regionName: string | null;
};

export type CatalogRegionOption = { id: string; name: string };

type CatalogPositionsTableProps = {
  positions: CatalogPositionRow[];
  canDelete: boolean;
  canAssign: boolean;
};

type CatalogSitesTableProps = {
  sites: CatalogSiteRow[];
  canDelete: boolean;
  /** Active regions to pick from; with canUpdate the region is editable per row. */
  regions?: CatalogRegionOption[];
  canUpdate?: boolean;
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
        variant: "primary",
        truncate: true,
      },
      {
        id: "area",
        header: "Área",
        accessor: (row) => row.areaName,
        variant: "muted",
      },
      {
        id: "activities",
        header: "Actividades",
        accessor: (row) =>
          row.activities.map((activity) => activity.name).join(" "),
        cell: (row) =>
          row.activities.length === 0 ? (
            <EmptyValue />
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
                      <CompanyField />
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
        cell: (row) => (
          <Badge tone={activeTone(row.active)}>
            {row.active ? "Activo" : "Inactivo"}
          </Badge>
        ),
      },
    ],
    [canAssign],
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
      mobileCard={(row) => ({
        title: row.name,
        subtitle: row.areaName,
        badge: (
          <Badge tone={activeTone(row.active)}>
            {row.active ? "Activo" : "Inactivo"}
          </Badge>
        ),
      })}
      rowMenu={
        canDelete
          ? (row) => (
              <RowMenu
                actions={[
                  catalogDeleteAction(
                    deletePositionAction.bind(null, row.id),
                    "puesto",
                    row.name,
                  ),
                ]}
                label={`Acciones de ${row.name}`}
              />
            )
          : undefined
      }
      searchPlaceholder="Buscar puesto, área o actividad"
    />
  );
};

export const CatalogSitesTable = ({
  sites,
  canDelete,
  regions = [],
  canUpdate = false,
}: CatalogSitesTableProps) => {
  const [editingRegion, setEditingRegion] = useState<CatalogSiteRow | null>(
    null,
  );
  const columns = useMemo<DataTableColumn<CatalogSiteRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "kind",
        header: "Tipo",
        accessor: (row) => row.kindLabel,
        variant: "muted",
      },
      {
        id: "region",
        header: "Región",
        accessor: (row) => row.regionName ?? "",
        variant: "muted",
      },
      {
        id: "status",
        header: "Estado",
        accessor: () => "Activa",
        cell: () => <Badge tone={activeTone(true)}>Activa</Badge>,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={sites}
        emptyTitle="Sin sucursales registradas."
        getRowId={(row) => row.id}
        layout="inset"
        mobileCard={(row) => ({
          title: row.name,
          subtitle: [row.kindLabel, row.regionName].filter(Boolean).join(" · "),
          badge: <Badge tone={activeTone(true)}>Activa</Badge>,
        })}
        rowMenu={
          canUpdate || canDelete
            ? (row) => (
                <RowMenu
                  actions={[
                    canUpdate && {
                      label: "Cambiar región",
                      icon: MapPinIcon,
                      onSelect: () => setEditingRegion(row),
                    },
                    canDelete &&
                      catalogDeleteAction(
                        deleteSiteAction.bind(null, row.id),
                        "sucursal",
                        row.name,
                      ),
                  ]}
                  label={`Acciones de ${row.name}`}
                />
              )
            : undefined
        }
        searchPlaceholder="Buscar sucursal"
      />
      {editingRegion ? (
        <CatalogEditDialog
          action={setSiteRegionAction.bind(null, editingRegion.id)}
          description={editingRegion.name}
          key={editingRegion.id}
          onClose={() => setEditingRegion(null)}
          title="Cambiar región"
        >
          <CompanyField />
          <div className="space-y-2">
            <Label htmlFor="site-region">Región</Label>
            <FormSelect
              defaultValue={editingRegion.regionId ?? ""}
              id="site-region"
              name="regionId"
              options={[
                { value: "", label: "Sin región" },
                ...regions.map((region) => ({
                  value: region.id,
                  label: region.name,
                })),
              ]}
              variant="field"
            />
          </div>
        </CatalogEditDialog>
      ) : null}
    </>
  );
};
