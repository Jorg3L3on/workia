"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId } from "react";

import { FormSelect } from "@/components/ui/form-select";
import { IconButton } from "@/components/ui/icon-button";

type DataTableFooterProps = {
  /** 0-based index of the first row on this page. */
  offset: number;
  pageRowCount: number;
  total: number;
  pageSize: number;
  pageSizes: readonly number[];
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: number) => void;
};

const formatCount = (value: number) => value.toLocaleString("es-MX");

/** The table owns count, page size and paging: «1–25 de 35 · 25 por página ‹ ›». */
export const DataTableFooter = ({
  offset,
  pageRowCount,
  total,
  pageSize,
  pageSizes,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onPageSizeChange,
}: DataTableFooterProps) => {
  const pageSizeId = useId();
  const from = pageRowCount === 0 ? 0 : offset + 1;
  const to = offset + pageRowCount;

  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2 text-sm"
      data-slot="data-table-footer"
    >
      <p aria-live="polite" className="tabular-nums">
        {formatCount(from)}–{formatCount(to)} de {formatCount(total)}
      </p>
      <div className="flex items-center gap-1">
        {pageSizes.length > 1 ? (
          <div className="mr-2">
            <label className="sr-only" htmlFor={pageSizeId}>
              Filas por página
            </label>
            <FormSelect
              aria-label="Filas por página"
              id={pageSizeId}
              onValueChange={(next) => onPageSizeChange(Number(next))}
              options={pageSizes.map((size) => ({
                value: String(size),
                label: `${size} por página`,
              }))}
              triggerClassName="h-8 w-auto gap-1 border-transparent bg-transparent shadow-none dark:bg-transparent"
              value={String(pageSize)}
            />
          </div>
        ) : null}
        <IconButton
          disabled={!canPrevious}
          label="Página anterior"
          onClick={onPrevious}
          size="icon-sm"
          type="button"
        >
          <ChevronLeftIcon aria-hidden />
        </IconButton>
        <IconButton
          disabled={!canNext}
          label="Página siguiente"
          onClick={onNext}
          size="icon-sm"
          type="button"
        >
          <ChevronRightIcon aria-hidden />
        </IconButton>
      </div>
    </div>
  );
};
