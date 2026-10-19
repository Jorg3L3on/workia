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
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  ListEmptyState,
  ListTableShell,
} from "@/components/list/list-table-shell";
import {
  FilterBar,
  type FilterAdvancedField,
  type FilterChipConfig,
  type FilterDateRangeConfig,
} from "@/components/layout/filter-bar";
import { DataTableFooter } from "@/components/ui/data-table/data-table-footer";
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
import { DEFAULT_LIST_PAGE_SIZE, LIST_PAGE_SIZES } from "@/lib/list/paging";
import { cn } from "@/lib/utils";

export type DataTableColumn<TData> = {
  id: string;
  header: string;
  /** Value used for sorting, search and the default cell. */
  accessor: (row: TData) => unknown;
  cell?: (row: TData) => ReactNode;
  enableSorting?: boolean;
  /**
   * primary: the record's name, regular weight in the darker ink.
   * muted: secondary text (RFC, dates) in the muted ink with tabular-nums.
   * numeric: muted, tabular-nums and right-aligned.
   */
  variant?: "primary" | "muted" | "numeric";
  /** Truncates to one line; the full text shows as a tooltip. */
  truncate?: boolean;
  headerClassName?: string;
  cellClassName?: string;
};

export type DataTableMobileCard = {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
};

export type DataTableProps<TData> = {
  data: TData[];
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  /** false hides the search box (the page filters on its own). */
  searchable?: boolean;
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
  pageSizes?: readonly number[];
  initialPageSize?: number;
  /** Chips of the FilterBar above the table; they apply on change. */
  filters?: FilterChipConfig[];
  dateRange?: FilterDateRangeConfig;
  /** Text filters in the «Avanzado» popover. */
  advancedFilters?: FilterAdvancedField[];
  /**
   * «Limpiar»: clears the filters (and, in server mode, `q` in the same URL
   * update). Without it, «Limpiar» only clears the search.
   */
  onClearFilters?: () => void;
  /** Extra controls after the chips. */
  toolbar?: ReactNode;
  /** The row opens its record. */
  getRowHref?: (row: TData) => string | undefined;
  getRowAriaLabel?: (row: TData) => string | undefined;
  /** At most one action, as a `RowInlineAction`, shown on hover and focus. */
  inlineAction?: (row: TData) => ReactNode;
  /** Every other action, as a `RowMenu`. */
  rowMenu?: (row: TData) => ReactNode;
  /** Content shown under a row (spans the table), e.g. an open panel. */
  renderAfterRow?: (row: TData) => ReactNode;
  /** Below 768px each row is a card; defaults to the first two columns. */
  mobileCard?: (row: TData) => DataTableMobileCard;
  /** `inset` drops the toolbar wrap when the table already sits in a panel. */
  layout?: "page" | "inset";
  /** Test id on every table row (cards get `<id>-card`). */
  rowTestId?: string;
  /**
   * Server mode: `data` is already the current page. Paging and the page
   * size (and the search, when it has `onQueryChange`) are owned by the URL;
   * sorting is disabled because it would only reorder one page.
   */
  server?: DataTableServerControls;
};

export type DataTableServerControls = {
  /** Rows matching the current filters across all pages. */
  total: number;
  /** 1-based current page. */
  page: number;
  pageSize: number;
  query?: string;
  /** True when a search or toolbar filter narrows the list. */
  hasFilters: boolean;
  onQueryChange?: (query: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const stringifyValue = (value: unknown) => {
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

  return stringifyValue(left).localeCompare(stringifyValue(right), "es", {
    numeric: true,
    sensitivity: "base",
  });
};

/** An empty value: a muted dash. */
export const EmptyValue = () => (
  <span aria-label="Sin dato" className="text-muted-foreground/70">
    —
  </span>
);

const variantClassName = {
  primary: "text-foreground",
  muted: "text-muted-foreground tabular-nums",
  numeric: "text-muted-foreground text-right tabular-nums",
} as const;

/** Keeps clicks on row actions (and dialogs they open) from opening the row. */
const stopRowEvent = (event: MouseEvent | KeyboardEvent) => {
  event.stopPropagation();
};

const ActionsSlot = ({
  inline,
  menu,
  className,
}: {
  inline: ReactNode;
  menu: ReactNode;
  className?: string;
}) => (
  <div
    className={cn("flex items-center justify-end gap-1", className)}
    onClick={stopRowEvent}
    onKeyDown={stopRowEvent}
  >
    {inline ? (
      <div className="opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        {inline}
      </div>
    ) : null}
    {menu}
  </div>
);

export const DataTable = <TData,>({
  data,
  columns,
  getRowId,
  searchable = true,
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
  pageSizes = LIST_PAGE_SIZES,
  initialPageSize,
  filters,
  dateRange,
  advancedFilters,
  onClearFilters,
  toolbar,
  getRowHref,
  getRowAriaLabel,
  inlineAction,
  rowMenu,
  renderAfterRow,
  mobileCard,
  layout = "page",
  rowTestId,
  server,
}: DataTableProps<TData>) => {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(initialSearch);
  const [localPagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize:
      initialPageSize ??
      (pageSizes.includes(DEFAULT_LIST_PAGE_SIZE)
        ? DEFAULT_LIST_PAGE_SIZE
        : (pageSizes[0] ?? DEFAULT_LIST_PAGE_SIZE)),
  });
  const pagination: PaginationState = server
    ? { pageIndex: server.page - 1, pageSize: server.pageSize }
    : localPagination;
  const onServerQueryChange = server?.onQueryChange;
  const showSearch = searchable && (!server || Boolean(onServerQueryChange));
  const hasActions = Boolean(inlineAction || rowMenu);

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
        cell: ({ row }) => {
          const custom = column.cell?.(row.original);
          const text = stringifyValue(column.accessor(row.original));
          const content = custom ?? (text ? text : <EmptyValue />);

          return column.truncate ? (
            <span className="block truncate" title={text || undefined}>
              {content}
            </span>
          ) : (
            content
          );
        },
        meta: { column },
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
        .map((column) => stringifyValue(column.accessor(row.original)))
        .join(" ");
      const extra = getSearchText?.(row.original) ?? "";

      return `${fromColumns} ${extra}`.toLowerCase().includes(query);
    },
  });

  const handleSearchChange = (next: string) => {
    if (server) {
      onServerQueryChange?.(next);
      return;
    }

    setGlobalFilter(next);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const handleClear = () => {
    if (onClearFilters) {
      onClearFilters();
    } else if (server) {
      onServerQueryChange?.("");
    }

    if (!server) {
      handleSearchChange("");
    }
  };

  const handlePageSizeChange = (next: number) => {
    if (server) {
      server.onPageSizeChange(next);
      return;
    }

    setPagination({ pageIndex: 0, pageSize: next });
  };

  const filteredCount = server
    ? server.total
    : table.getFilteredRowModel().rows.length;
  const pageRows = table.getRowModel().rows;
  const hasSourceRows = server
    ? data.length > 0 || server.hasFilters
    : data.length > 0;
  const showNoMatches = hasSourceRows && filteredCount === 0;
  const showEmpty = !hasSourceRows;
  const columnCount = columns.length + (hasActions ? 1 : 0);

  const openRow = (href: string | undefined) => {
    if (href) router.push(href);
  };

  const rowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    href: string | undefined,
  ) => {
    if (href && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      router.push(href);
    }
  };

  const rowLinkProps = (row: TData) => {
    const href = getRowHref?.(row);

    return href
      ? {
          "aria-label": getRowAriaLabel?.(row) ?? `Abrir fila ${getRowId(row)}`,
          role: "link",
          tabIndex: 0,
          onClick: () => openRow(href),
          onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
            rowKeyDown(event, href),
        }
      : {};
  };

  const defaultCard = (row: TData): DataTableMobileCard => {
    const [first, second] = table
      .getRowModel()
      .rowsById[getRowId(row)]?.getVisibleCells() ?? [undefined, undefined];

    return {
      title: first
        ? flexRender(first.column.columnDef.cell, first.getContext())
        : null,
      subtitle: second
        ? flexRender(second.column.columnDef.cell, second.getContext())
        : null,
    };
  };

  return (
    <div className="space-y-3">
      <FilterBar
        advanced={advancedFilters}
        dateRange={dateRange}
        filters={filters}
        onClear={handleClear}
        search={
          showSearch
            ? {
                value: server ? (server.query ?? "") : globalFilter,
                onChange: handleSearchChange,
                placeholder: searchPlaceholder,
                ariaLabel: searchAriaLabel,
                debounceMs: server ? undefined : 0,
              }
            : undefined
        }
      >
        {toolbar}
      </FilterBar>

      <ListTableShell>
        {showEmpty || showNoMatches ? (
          <ListEmptyState
            action={showEmpty ? emptyAction : undefined}
            description={
              showNoMatches ? noMatchesDescription : emptyDescription
            }
            title={showNoMatches ? noMatchesTitle : emptyTitle}
          />
        ) : (
          <>
            <ul className="divide-border/60 divide-y md:hidden">
              {pageRows.map((row) => {
                const card = (mobileCard ?? defaultCard)(row.original);
                const href = getRowHref?.(row.original);
                const after = renderAfterRow?.(row.original);

                return (
                  <li
                    data-testid={rowTestId ? `${rowTestId}-card` : undefined}
                    key={row.id}
                  >
                    <div
                      className={cn(
                        "group/row flex items-start gap-3 px-4 py-3",
                        href && "hover:bg-muted/40 cursor-pointer",
                      )}
                      data-slot="data-table-card"
                      {...rowLinkProps(row.original)}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-foreground truncate">
                          {card.title}
                        </div>
                        {card.subtitle ? (
                          <div className="text-muted-foreground truncate text-sm tabular-nums">
                            {card.subtitle}
                          </div>
                        ) : null}
                        {card.badge ? <div>{card.badge}</div> : null}
                      </div>
                      {hasActions ? (
                        <ActionsSlot
                          className="-mr-1 shrink-0"
                          inline={inlineAction?.(row.original)}
                          menu={rowMenu?.(row.original)}
                        />
                      ) : null}
                    </div>
                    {after ? <div className="px-4 pb-4">{after}</div> : null}
                  </li>
                );
              })}
            </ul>

            <Table className="hidden md:table">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    className="hover:bg-transparent"
                    key={headerGroup.id}
                  >
                    {headerGroup.headers.map((header) => {
                      const { column } = header.column.columnDef.meta as {
                        column: DataTableColumn<TData>;
                      };
                      const sorted = header.column.getIsSorted();
                      const canSort = header.column.getCanSort();
                      const numeric = column.variant === "numeric";

                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : undefined
                          }
                          className={cn(
                            "text-muted-foreground h-10 px-4 text-xs font-medium",
                            numeric && "text-right",
                            column.headerClassName,
                          )}
                        >
                          {canSort ? (
                            <button
                              className={cn(
                                "group/sort hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-3",
                                numeric && "flex-row-reverse",
                                sorted && "text-foreground",
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                              type="button"
                            >
                              {column.header}
                              {sorted === "desc" ? (
                                <ArrowDownIcon
                                  aria-hidden
                                  className="size-3.5"
                                />
                              ) : (
                                <ArrowUpIcon
                                  aria-hidden
                                  className={cn(
                                    "size-3.5",
                                    !sorted &&
                                      "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
                                  )}
                                />
                              )}
                              <span className="sr-only">
                                {`Ordenar por ${column.header}`}
                              </span>
                            </button>
                          ) : (
                            column.header
                          )}
                        </TableHead>
                      );
                    })}
                    {hasActions ? (
                      <TableHead className="w-0 px-2">
                        <span className="sr-only">Acciones</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => {
                  const href = getRowHref?.(row.original);
                  const after = renderAfterRow?.(row.original);

                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={cn(
                          "group/row border-border/50",
                          href && "cursor-pointer",
                        )}
                        data-testid={rowTestId}
                        {...rowLinkProps(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const { column } = cell.column.columnDef.meta as {
                            column: DataTableColumn<TData>;
                          };

                          return (
                            <TableCell
                              className={cn(
                                "h-12 min-w-0 px-4 py-2",
                                column.truncate && "max-w-64",
                                column.variant
                                  ? variantClassName[column.variant]
                                  : undefined,
                                column.cellClassName,
                              )}
                              key={cell.id}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </TableCell>
                          );
                        })}
                        {hasActions ? (
                          <TableCell className="h-12 w-0 px-2 py-2">
                            <ActionsSlot
                              inline={inlineAction?.(row.original)}
                              menu={rowMenu?.(row.original)}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                      {after ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            className="bg-muted/20 px-4 py-4 whitespace-normal"
                            colSpan={columnCount}
                          >
                            {after}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <DataTableFooter
              canNext={table.getCanNextPage()}
              canPrevious={table.getCanPreviousPage()}
              offset={pagination.pageIndex * pagination.pageSize}
              onNext={() =>
                server ? server.onPageChange(server.page + 1) : table.nextPage()
              }
              onPageSizeChange={handlePageSizeChange}
              onPrevious={() =>
                server
                  ? server.onPageChange(server.page - 1)
                  : table.previousPage()
              }
              pageRowCount={pageRows.length}
              pageSize={pagination.pageSize}
              pageSizes={pageSizes}
              total={filteredCount}
            />
          </>
        )}
      </ListTableShell>
    </div>
  );
};
