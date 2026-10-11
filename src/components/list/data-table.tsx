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
  useEffect,
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
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDateMx,
  formatDateTimeMx,
  looksLikeDateValue,
} from "@/lib/format/date";
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
  /**
   * Server mode: `data` is already the current page. Search, paging and the
   * page size are owned by the URL (via the callbacks); sorting is disabled
   * because it would only reorder one page.
   */
  server?: DataTableServerControls;
};

export type DataTableServerControls = {
  /** Rows matching the current filters across all pages. */
  total: number;
  /** 1-based current page. */
  page: number;
  pageSize: number;
  query: string;
  /** True when a search or toolbar filter narrows the list. */
  hasFilters: boolean;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const SEARCH_DEBOUNCE_MS = 300;

const stringifySearchValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return formatDateTimeMx(value);
  }

  if (typeof value === "string" && looksLikeDateValue(value)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ? formatDateMx(value)
      : formatDateTimeMx(value);
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
  server,
}: DataTableProps<TData>) => {
  const searchId = useId();
  const pageSizeId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(initialSearch);
  const [localPagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize ?? pageSizes[0] ?? 10,
  });
  const pagination: PaginationState = server
    ? { pageIndex: server.page - 1, pageSize: server.pageSize }
    : localPagination;
  const [serverSearch, setServerSearch] = useState(server?.query ?? "");
  const serverQuery = server?.query;
  const onServerQueryChange = server?.onQueryChange;

  // Debounce typing into the URL; skip when the box already matches it.
  useEffect(() => {
    if (!onServerQueryChange || serverSearch.trim() === (serverQuery ?? "")) {
      return;
    }

    const timer = setTimeout(
      () => onServerQueryChange(serverSearch.trim()),
      SEARCH_DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
  }, [serverSearch, serverQuery, onServerQueryChange]);

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
        enableSorting: server ? false : (column.enableSorting ?? true),
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
    [columns, server],
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
    ...(server
      ? {
          manualPagination: true,
          manualFiltering: true,
          pageCount: Math.max(1, Math.ceil(server.total / server.pageSize)),
        }
      : {}),
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
    if (server) {
      setServerSearch(event.target.value);
      return;
    }

    setGlobalFilter(event.target.value);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const handlePageSizeChange = (next: string) => {
    if (server) {
      server.onPageSizeChange(Number(next));
      return;
    }

    setPagination({ pageIndex: 0, pageSize: Number(next) });
  };

  const filteredCount = server
    ? server.total
    : table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageRows = table.getRowModel().rows;
  const visibleRows = pageRows.map((row) => row.original);
  const hasSourceRows = server
    ? data.length > 0 || server.hasFilters
    : data.length > 0;
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
      <div className="flex flex-col gap-3">
        <div
          className={cn(
            "flex flex-col gap-3",
            layout === "page" && "sm:flex-row sm:flex-wrap sm:items-center",
          )}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              aria-label={searchAriaLabel}
              className="bg-card h-10 rounded-xl pl-9"
              id={searchId}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
              type="search"
              value={server ? serverSearch : globalFilter}
            />
          </div>
          {toolbar}
          {pageSizes.length > 1 ? (
            <div className="sm:w-40">
              <label className="sr-only" htmlFor={pageSizeId}>
                Filas por página
              </label>
              <FormSelect
                aria-label="Filas por página"
                id={pageSizeId}
                onValueChange={handlePageSizeChange}
                options={pageSizes.map((size) => ({
                  value: String(size),
                  label: `${size} por página`,
                }))}
                value={String(pagination.pageSize)}
              />
            </div>
          ) : null}
          <ListResultCount
            count={filteredCount}
            plural={resultPlural}
            singular={resultSingular}
            total={server ? server.total : scopedData.length}
          />
        </div>
      </div>

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
        <Pagination className="mx-0 justify-between">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página {pagination.pageIndex + 1} de {pageCount}
          </p>
          <PaginationContent>
            <PaginationItem>
              <Button
                aria-label="Página anterior"
                disabled={!table.getCanPreviousPage()}
                onClick={() =>
                  server
                    ? server.onPageChange(server.page - 1)
                    : table.previousPage()
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Anterior
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                aria-label="Página siguiente"
                disabled={!table.getCanNextPage()}
                onClick={() =>
                  server
                    ? server.onPageChange(server.page + 1)
                    : table.nextPage()
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Siguiente
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
};
