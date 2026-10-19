"use client";

import { PencilIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  CatalogEditDialog,
  catalogDeleteAction,
} from "@/components/catalog/catalog-row-menu";
import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const RegionStatus = ({ row }: { row: CatalogRegionRow }) => (
  <Badge tone={activeTone(row.active)}>
    {row.active ? "Activa" : "Inactiva"}
  </Badge>
);

/** Regions over sites (WRK-I5-4): rename, activate or deactivate from the menu. */
export const CatalogRegionsTable = ({
  regions,
  canUpdate,
  canDelete,
}: CatalogRegionsTableProps) => {
  const [renaming, setRenaming] = useState<CatalogRegionRow | null>(null);

  const columns = useMemo<DataTableColumn<CatalogRegionRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "sites",
        header: "Sucursales",
        accessor: (row) => row.siteCount,
        variant: "numeric",
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => (row.active ? "Activa" : "Inactiva"),
        cell: (row) => <RegionStatus row={row} />,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={regions}
        emptyTitle="Sin regiones registradas."
        getRowId={(row) => row.id}
        layout="inset"
        mobileCard={(row) => ({
          title: row.name,
          subtitle: `${row.siteCount} ${row.siteCount === 1 ? "sucursal" : "sucursales"}`,
          badge: <RegionStatus row={row} />,
        })}
        rowMenu={
          canUpdate || canDelete
            ? (row) => (
                <RowMenu
                  actions={[
                    canUpdate && {
                      label: "Renombrar",
                      icon: PencilIcon,
                      onSelect: () => setRenaming(row),
                    },
                    canUpdate && {
                      label: row.active ? "Desactivar" : "Activar",
                      icon: row.active ? PowerOffIcon : PowerIcon,
                      action: updateRegionAction.bind(null, row.id),
                      fields: (
                        <>
                          <CompanyField />
                          <input name="name" type="hidden" value={row.name} />
                          <input
                            name="active"
                            type="hidden"
                            value={row.active ? "false" : "true"}
                          />
                        </>
                      ),
                    },
                    canDelete &&
                      catalogDeleteAction(
                        deleteRegionAction.bind(null, row.id),
                        "región",
                        row.name,
                      ),
                  ]}
                  label={`Acciones de ${row.name}`}
                />
              )
            : undefined
        }
        searchPlaceholder="Buscar región"
      />
      {renaming ? (
        <CatalogEditDialog
          action={updateRegionAction.bind(null, renaming.id)}
          key={renaming.id}
          onClose={() => setRenaming(null)}
          title="Renombrar región"
        >
          <CompanyField />
          <input
            name="active"
            type="hidden"
            value={renaming.active ? "true" : "false"}
          />
          <div className="space-y-2">
            <Label htmlFor="region-name">Nombre</Label>
            <Input
              defaultValue={renaming.name}
              id="region-name"
              name="name"
              required
            />
          </div>
        </CatalogEditDialog>
      ) : null}
    </>
  );
};
