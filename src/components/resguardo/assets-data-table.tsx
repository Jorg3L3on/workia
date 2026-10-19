"use client";

import {
  PackageCheckIcon,
  PackageOpenIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Badge, Tag } from "@/components/ui/badge";
import {
  DataTable,
  RowInlineAction,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { formatDateMx } from "@/lib/format/date";
import type { AssetListItem, PersonAssetItem } from "@/lib/resguardo";
import { assetCategoryLabels, assetStatusLabels } from "@/lib/resguardo/schema";
import { toneFor } from "@/lib/ui/status-tone";

const categoryLabel = (category: string) =>
  assetCategoryLabels[category as keyof typeof assetCategoryLabels] ?? category;

const AssetStatus = ({ row }: { row: AssetListItem }) => (
  <Badge tone={toneFor("asset", row.status)}>
    {assetStatusLabels[row.status]}
  </Badge>
);

/** Entregar while in storage, Devolver while assigned (only tracked assets). */
const handoverFor = (
  row: AssetListItem,
): { label: string; icon: LucideIcon; href: string } | null => {
  if (!row.tracksHistory) {
    return null;
  }

  if (row.status === "disponible") {
    return {
      label: "Entregar",
      icon: PackageOpenIcon,
      href: `/app/resguardo/${row.id}?assign=1`,
    };
  }

  if (row.status === "asignado" && row.holderId) {
    return {
      label: "Devolver",
      icon: PackageCheckIcon,
      href: `/app/resguardo/${row.id}?return=1`,
    };
  }

  return null;
};

type AssetsDataTableProps = {
  assets: AssetListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasFilters: boolean;
  /** Search and status chip, server-side through ?q= and ?status=. */
  query: string;
  status: string;
  canUpdate: boolean;
  emptyAction?: ReactNode;
  emptyDescription: string;
};

/** The inventory: the row opens the asset; Entregar / Devolver inline. */
export const AssetsDataTable = ({
  assets,
  total,
  page,
  pageSize,
  hasFilters,
  query,
  status,
  canUpdate,
  emptyAction,
  emptyDescription,
}: AssetsDataTableProps) => {
  const controls = useServerListControls();

  const columns = useMemo<DataTableColumn<AssetListItem>[]>(
    () => [
      {
        id: "name",
        header: "Activo",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "identifier",
        header: "Identificador",
        accessor: (row) =>
          `${row.identifier}${row.tracksHistory ? "" : " · sin historial"}`,
        variant: "muted",
        truncate: true,
      },
      {
        id: "category",
        header: "Categoría",
        accessor: (row) => categoryLabel(row.category),
        variant: "muted",
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => assetStatusLabels[row.status],
        cell: (row) => <AssetStatus row={row} />,
      },
      {
        id: "holder",
        header: "Resguardante",
        accessor: (row) => row.holderName ?? "",
        truncate: true,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={assets}
      emptyAction={emptyAction}
      emptyDescription={emptyDescription}
      emptyTitle="Aún no hay activos registrados"
      getRowAriaLabel={(row) => `Ver detalle de ${row.name}`}
      getRowHref={(row) => `/app/resguardo/${row.id}`}
      getRowId={(row) => row.id}
      inlineAction={
        canUpdate
          ? (row) => {
              const handover = handoverFor(row);

              return handover ? (
                <RowInlineAction
                  href={handover.href}
                  icon={handover.icon}
                  label={`${handover.label} ${row.name}`}
                />
              ) : null;
            }
          : undefined
      }
      mobileCard={(row) => ({
        title: row.name,
        subtitle: [row.identifier, row.holderName].filter(Boolean).join(" · "),
        badge: <AssetStatus row={row} />,
      })}
      pageSizes={controls.pageSizes}
      filters={[
        {
          id: "status",
          label: "Estado",
          value: status,
          onChange: (next) => controls.setFilter("status", next || null),
          options: [
            { value: "disponible", label: assetStatusLabels.disponible },
            { value: "asignado", label: assetStatusLabels.asignado },
            { value: "baja", label: assetStatusLabels.baja },
          ],
        },
      ]}
      onClearFilters={() => controls.setFilters({ q: null, status: null })}
      rowTestId="asset-row"
      searchAriaLabel="Buscar activos"
      searchPlaceholder="Buscar activos..."
      server={{
        total,
        page,
        pageSize,
        hasFilters,
        query,
        onQueryChange: controls.setQuery,
        onPageChange: controls.setPage,
        onPageSizeChange: controls.setPageSize,
      }}
    />
  );
};

/** The expediente's Resguardo tab: what the person holds today. */
export const PersonAssetsTable = ({
  assets,
}: {
  assets: PersonAssetItem[];
}) => {
  const columns = useMemo<DataTableColumn<PersonAssetItem>[]>(
    () => [
      {
        id: "name",
        header: "Activo",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      {
        id: "identifier",
        header: "Identificador",
        accessor: (row) => row.identifier,
        variant: "muted",
      },
      {
        id: "category",
        header: "Categoría",
        accessor: (row) => categoryLabel(row.category),
        variant: "muted",
      },
      {
        id: "condition",
        header: "Condición",
        accessor: (row) => row.conditionNote ?? "",
        variant: "muted",
        truncate: true,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={assets}
      emptyDescription="Cuando tenga activos en custodia, aparecerán aquí."
      emptyTitle="Sin equipo asignado"
      getRowAriaLabel={(row) => `Ver activo ${row.name}`}
      getRowHref={(row) => `/app/resguardo/${row.id}`}
      getRowId={(row) => row.id}
      layout="inset"
      searchable={false}
    />
  );
};

export type AssetMovementRow = {
  id: string;
  /** ISO date. */
  date: string;
  typeLabel: string;
  personId: string;
  personName: string;
  condition: string;
};

/** An asset's handovers and returns, newest first; the row opens the person. */
export const AssetMovementsTable = ({
  movements,
}: {
  movements: AssetMovementRow[];
}) => {
  const columns = useMemo<DataTableColumn<AssetMovementRow>[]>(
    () => [
      {
        id: "date",
        header: "Fecha",
        accessor: (row) => row.date,
        variant: "muted",
      },
      {
        id: "type",
        header: "Tipo",
        accessor: (row) => row.typeLabel,
        cell: (row) => <Tag>{row.typeLabel}</Tag>,
      },
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.personName,
        variant: "primary",
        truncate: true,
      },
      {
        id: "condition",
        header: "Condición",
        accessor: (row) => row.condition,
        variant: "muted",
        truncate: true,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={movements}
      emptyDescription="La primera entrega quedará registrada aquí."
      emptyTitle="Sin movimientos aún"
      getRowAriaLabel={(row) => `Ver expediente de ${row.personName}`}
      getRowHref={(row) => `/app/personas/${row.personId}`}
      getRowId={(row) => row.id}
      layout="inset"
      mobileCard={(row) => ({
        title: row.personName,
        subtitle: [formatDateMx(row.date), row.condition]
          .filter(Boolean)
          .join(" · "),
        badge: <Tag>{row.typeLabel}</Tag>,
      })}
      searchable={false}
    />
  );
};
