"use client";

import { useMemo, type ReactNode } from "react";

import { FileTextIcon, PencilIcon } from "lucide-react";

import { PeopleFilterBar } from "@/components/people/filter/people-filter-bar";
import {
  PeopleColumnsMenu,
  PeopleExportButton,
} from "@/components/people/filter/people-columns-menu";
import { PeopleViewsTabs } from "@/components/people/filter/people-views-tabs";
import { usePeopleListUrl } from "@/components/people/filter/use-people-list-url";
import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { formatDateMx } from "@/lib/format/date";
import {
  PEOPLE_COLUMNS,
  type PeopleColumnDefinition,
  type PeopleColumnId,
} from "@/lib/people/filter/columns";
import type { PeopleFilterOptions } from "@/lib/people/filter/describe";
import type { PeopleFilterFieldDefinition } from "@/lib/people/filter/fields";
import {
  isEmptyPeopleFilter,
  type PeopleFilter,
} from "@/lib/people/filter/schema";
import { personDeletedLabel, personStatusLabels } from "@/lib/people/schema";
import type { PeopleViewSummary } from "@/lib/people/views";
import { deletedTone, toneFor } from "@/lib/ui/status-tone";

export type { PersonaListRow } from "@/components/people/persona-list-row";

type PersonasDataTableProps = {
  people: PersonaListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The applied filter (already without fields the user may not use). */
  filter: PeopleFilter;
  /** Fields the user may filter by. */
  fields: PeopleFilterFieldDefinition[];
  options: PeopleFilterOptions;
  /** Mexico's date, for the calendar shortcuts. */
  today: string;
  /** Visible columns after «Nombre», in order. */
  columns: PeopleColumnId[];
  /** Columns the user may pick. */
  allowedColumns: PeopleColumnDefinition[];
  views?: PeopleViewSummary[];
  activeViewId?: string | null;
  /** «Exportar (N)» (people:export). */
  canExport?: boolean;
  emptyAction?: ReactNode;
  /** Row menu: «Editar» and «Constancia de antigüedad». */
  canUpdate?: boolean;
  canReadContracts?: boolean;
};

const PersonStatus = ({ row }: { row: PersonaListRow }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <Badge tone={toneFor("person", row.status)}>
      {personStatusLabels[row.status]}
    </Badge>
    {row.deleted ? (
      <Badge tone={deletedTone}>{personDeletedLabel}</Badge>
    ) : null}
  </div>
);

const money = (value: string | null | undefined) =>
  value
    ? Number(value).toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN",
      })
    : "";

const MUTED_COLUMNS = new Set<PeopleColumnId>([
  "rfc",
  "curp",
  "nss",
  "telefono",
]);
const TRUNCATED_COLUMNS = new Set<PeopleColumnId>([
  "area",
  "puesto",
  "sucursal",
  "region",
  "jefe",
  "email",
  "motivoBaja",
]);

const toColumn = (id: PeopleColumnId): DataTableColumn<PersonaListRow> => {
  const header = PEOPLE_COLUMNS[id].label;

  if (id === "relacion") {
    return {
      id,
      header,
      accessor: (row) =>
        row.deleted
          ? `${personDeletedLabel} ${personStatusLabels[row.status]}`
          : personStatusLabels[row.status],
      cell: (row) => <PersonStatus row={row} />,
    };
  }

  if (PEOPLE_COLUMNS[id].payroll) {
    return {
      id,
      header,
      accessor: (row) => money(row.cells[id]),
      variant: "numeric",
    };
  }

  if (PEOPLE_COLUMNS[id].date) {
    return {
      id,
      header,
      accessor: (row) => row.cells[id] ?? "",
      cell: (row) => (row.cells[id] ? formatDateMx(row.cells[id]) : undefined),
      variant: "muted",
    };
  }

  return {
    id,
    header,
    accessor: (row) => row.cells[id] ?? "",
    variant: MUTED_COLUMNS.has(id) ? "muted" : undefined,
    truncate: TRUNCATED_COLUMNS.has(id),
  };
};

const cardValue = (row: PersonaListRow, id: PeopleColumnId) =>
  PEOPLE_COLUMNS[id].payroll
    ? money(row.cells[id])
    : PEOPLE_COLUMNS[id].date
      ? formatDateMx(row.cells[id])
      : row.cells[id];

export const PersonasDataTable = ({
  people,
  total,
  page,
  pageSize,
  filter,
  fields,
  options,
  today,
  columns: visibleColumns,
  allowedColumns,
  views,
  activeViewId = null,
  canExport = false,
  emptyAction,
  canUpdate = false,
  canReadContracts = false,
}: PersonasDataTableProps) => {
  const controls = useServerListControls();
  const url = usePeopleListUrl();

  const columns = useMemo<DataTableColumn<PersonaListRow>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
        fill: true,
      },
      ...visibleColumns.map(toColumn),
    ],
    [visibleColumns],
  );

  const viewingDeleted = filter.deleted;

  return (
    <div className="space-y-3">
      {views ? (
        <PeopleViewsTabs
          activeViewId={activeViewId}
          columns={visibleColumns}
          filter={filter}
          viewHref={url.viewHref}
          views={views}
        />
      ) : null}

      <PeopleFilterBar
        fields={fields}
        filter={filter}
        onApply={url.applyFilter}
        options={options}
        today={today}
        total={total}
      >
        <PeopleColumnsMenu
          allowed={allowedColumns}
          onChange={url.setColumns}
          visible={visibleColumns}
        />
        {canExport ? (
          <PeopleExportButton
            columns={visibleColumns}
            filter={filter}
            total={total}
          />
        ) : null}
      </PeopleFilterBar>

      <DataTable
        columns={columns}
        data={people}
        emptyAction={viewingDeleted ? undefined : emptyAction}
        emptyDescription={
          viewingDeleted
            ? "Los expedientes con borrado lógico aparecen aquí."
            : emptyAction
              ? "Da de alta a alguien para empezar el expediente."
              : "Cuando existan registros, los verás aquí."
        }
        emptyTitle={
          viewingDeleted
            ? "No hay expedientes borrados"
            : "Aún no hay personas en el expediente"
        }
        getRowAriaLabel={(row) =>
          row.deleted
            ? `Ver expediente borrado de ${row.name}`
            : `Ver expediente de ${row.name}`
        }
        getRowHref={(row) => `/app/personas/${row.id}`}
        getRowId={(row) => row.id}
        noMatchesDescription={
          viewingDeleted
            ? "Los expedientes con borrado lógico aparecen aquí."
            : "Prueba con otros filtros o limpia la búsqueda."
        }
        noMatchesTitle={
          viewingDeleted
            ? "No hay expedientes borrados"
            : "No hay coincidencias"
        }
        mobileCard={(row) => ({
          title: row.name,
          subtitle: visibleColumns
            .filter((id) => id !== "relacion")
            .slice(0, 2)
            .map((id) => cardValue(row, id))
            .filter((value) => value && value !== "—")
            .join(" · "),
          badge: <PersonStatus row={row} />,
        })}
        pageSizes={controls.pageSizes}
        rowMenu={(row) =>
          row.deleted || (!canUpdate && !canReadContracts) ? null : (
            <RowMenu
              actions={[
                canUpdate && {
                  label: "Editar",
                  icon: PencilIcon,
                  href: `/app/personas/${row.id}?edit=1`,
                },
                canReadContracts && {
                  label: "Constancia de antigüedad",
                  icon: FileTextIcon,
                  href: `/app/personas/${row.id}/constancia`,
                },
              ]}
              label={`Acciones de ${row.name}`}
            />
          )
        }
        rowTestId="persona-row"
        searchable={false}
        server={{
          total,
          page,
          pageSize,
          hasFilters: !isEmptyPeopleFilter(filter),
          onPageChange: controls.setPage,
          onPageSizeChange: controls.setPageSize,
        }}
      />
    </div>
  );
};
