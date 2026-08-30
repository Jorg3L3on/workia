"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react";
import {
  Fragment,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { ClickableTableRow } from "@/components/list/clickable-table-row";
import {
  ListEmptyState,
  ListResultCount,
  ListTableShell,
  listTableDensityClassName,
} from "@/components/list/list-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;

export type DataTableColumn<TData> = {
  id: string;
  header: string;
  /** Value used for sorting and the default global search. */
  accessor: (row: TData) => unknown;
  cell?: (row: TData) => ReactNode;
  enableSorting?: boolean;
  headerClassName?: string;
  cellClassName?: string;
};

export type DataTableProps<TData> = {
  data: TData[];
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  initialSearch?: string;
  /** Extra searchable text beyond column accessors. */
  getSearchText?: (row: TData) => string;
  /** Extra predicate applied before search (e.g. status). */
  filterRow?: (row: TData) => boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  noMatchesTitle?: string;
  noMatchesDescription?: string;
  resultSingular: string;
  resultPlural: string;
  pageSizes?: readonly number[];
  initialPageSize?: number;
  desktopOnly?: boolean;
  toolbar?: ReactNode;
  getRowHref?: (row: TData) => string | undefined;
  getRowAriaLabel?: (row: TData) => string | undefined;
  renderAfterRow?: (row: TData) => ReactNode;
  renderMobile?: (rows: TData[]) => ReactNode;
  /** `inset` drops the extra toolbar card when the table already sits in a panel. */
  layout?: "page" | "inset";
};

const stringifySearchValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

const compareTableValues = (left: unknown, right: unknown) => {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return -1;
  }

  if (right == null) {
    return 1;
  }

  if (left instanceof Date || right instanceof Date) {
    const leftTime =
      left instanceof Date ? left.getTime() : new Date(String(left)).getTime();
    const rightTime =
      right instanceof Date
        ? right.getTime()
        : new Date(String(right)).getTime();

    return leftTime - rightTime;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return stringifySearchValue(left).localeCompare(
    stringifySearchValue(right),
    "es",
    { numeric: true, sensitivity: "base" },
  );
};

export const DataTable = <TData,>({
  data,
  columns,
  getRowId,
  searchPlaceholder = "Buscar…",
  searchAriaLabel = "Buscar en la tabla",
  initialSearch = "",
  getSearchText,
  filterRow,
  emptyTitle,
  emptyDescription,
  emptyAction,
  noMatchesTitle = "No hay coincidencias",
  noMatchesDescription = "Prueba con otros términos o limpia la búsqueda.",
  resultSingular,
  resultPlural,
  pageSizes = DEFAULT_PAGE_SIZES,
  initialPageSize,
  desktopOnly = false,
  toolbar,
  getRowHref,
  getRowAriaLabel,
  renderAfterRow,
  renderMobile,
  layout = "page",
}: DataTableProps<TData>) => {
  const searchId = useId();
  const pageSizeId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(initialSearch);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize ?? pageSizes[0] ?? 10,
  });

  const scopedData = useMemo(
    () => (filterRow ? data.filter(filterRow) : data),
    [data, filterRow],
  );

  const tanstackColumns = useMemo<ColumnDef<TData>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row) => column.accessor(row),
        header: column.header,
        enableSorting: column.enableSorting ?? true,
        sortingFn: (left, right, columnId) =>
          compareTableValues(left.getValue(columnId), right.getValue(columnId)),
        cell: ({ row }) =>
          column.cell?.(row.original) ??
          (stringifySearchValue(column.accessor(row.original)) || "—"),
        meta: {
          headerClassName: column.headerClassName,
          cellClassName: column.cellClassName,
        },
      })),
    [columns],
  );

  const table = useReactTable({
    data: scopedData,
    columns: tanstackColumns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).trim().toLowerCase();

      if (!query) {
        return true;
      }

      const fromColumns = columns
        .map((column) => stringifySearchValue(column.accessor(row.original)))
        .join(" ");
      const extra = getSearchText?.(row.original) ?? "";

      return `${fromColumns} ${extra}`.toLowerCase().includes(query);
    },
  });

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setGlobalFilter(event.target.value);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSize = Number(event.target.value);
    setPagination({ pageIndex: 0, pageSize: nextSize });
  };

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageRows = table.getRowModel().rows;
  const visibleRows = pageRows.map((row) => row.original);
  const hasSourceRows = data.length > 0;
  const hasVisibleRows = pageRows.length > 0;
  const showNoMatches = hasSourceRows && filteredCount === 0;
  const showEmpty = !hasSourceRows;
  const hideTableOnMobile = Boolean(renderMobile);

  const emptyState = (
    <ListEmptyState
      action={showEmpty ? emptyAction : undefined}
      description={showNoMatches ? noMatchesDescription : emptyDescription}
      title={showNoMatches ? noMatchesTitle : emptyTitle}
    />
  );

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end",
          layout === "page" &&
            "border-border/70 bg-card rounded-xl border p-4 shadow-sm",
        )}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <label className="text-sm font-medium" htmlFor={searchId}>
            Buscar
          </label>
          <div className="relative">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              aria-label={searchAriaLabel}
              className="pl-8"
              id={searchId}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
              type="search"
              value={globalFilter}
            />
          </div>
        </div>
        {toolbar}
        <div className="space-y-2 sm:w-36">
          <label className="text-sm font-medium" htmlFor={pageSizeId}>
            Filas por página
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            id={pageSizeId}
            onChange={handlePageSizeChange}
            value={pagination.pageSize}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ListResultCount
        count={filteredCount}
        plural={resultPlural}
        singular={resultSingular}
      />

      {showEmpty || showNoMatches ? (
        <ListTableShell>{emptyState}</ListTableShell>
      ) : (
        <>
          {renderMobile ? (
            <div className="md:hidden">{renderMobile(visibleRows)}</div>
          ) : null}

          <ListTableShell desktopOnly={hideTableOnMobile || desktopOnly}>
            <Table className={listTableDensityClassName}>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta as
                        { headerClassName?: string } | undefined;
                      const sorted = header.column.getIsSorted();
                      const canSort = header.column.getCanSort();
                      const label = String(
                        header.column.columnDef.header ?? header.id,
                      );

                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            canSort
                              ? sorted === "asc"
                                ? "ascending"
                                : sorted === "desc"
                                  ? "descending"
                                  : "none"
                              : undefined
                          }
                          className={meta?.headerClassName}
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              className={cn(
                                "hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-3",
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                              type="button"
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              {sorted === "asc" ? (
                                <ArrowUpIcon aria-hidden className="size-3.5" />
                              ) : sorted === "desc" ? (
                                <ArrowDownIcon
                                  aria-hidden
                                  className="size-3.5"
                                />
                              ) : (
                                <span
                                  aria-hidden
                                  className="text-muted-foreground/70 text-[10px]"
                                >
                                  ↕
                                </span>
                              )}
                              <span className="sr-only">
                                {`Ordenar por ${label}`}
                              </span>
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => {
                  const href = getRowHref?.(row.original);
                  const cells = row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      { cellClassName?: string } | undefined;

                    return (
                      <TableCell className={meta?.cellClassName} key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  });

                  const tableRow = href ? (
                    <ClickableTableRow
                      ariaLabel={
                        getRowAriaLabel?.(row.original) ??
                        `Abrir fila ${getRowId(row.original)}`
                      }
                      href={href}
                    >
                      {cells}
                    </ClickableTableRow>
                  ) : (
                    <TableRow>{cells}</TableRow>
                  );

                  return (
                    <Fragment key={row.id}>
                      {tableRow}
                      {renderAfterRow?.(row.original)}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </ListTableShell>
        </>
      )}

      {hasVisibleRows && pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página {pagination.pageIndex + 1} de {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              aria-label="Página anterior"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              type="button"
              variant="outline"
            >
              Anterior
            </Button>
            <Button
              aria-label="Página siguiente"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              type="button"
              variant="outline"
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
