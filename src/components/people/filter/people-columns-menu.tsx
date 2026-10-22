"use client";

import { Columns3Icon, DownloadIcon, FileSpreadsheetIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  serializePeopleColumns,
  type PeopleColumnDefinition,
  type PeopleColumnId,
} from "@/lib/people/filter/columns";
import type { PeopleFilter } from "@/lib/people/filter/schema";
import { peopleFilterQueryString } from "@/lib/people/filter/url";

/** «Columnas»: which columns the list (and «Exportar (N)») shows. */
export const PeopleColumnsMenu = ({
  allowed,
  visible,
  onChange,
}: {
  allowed: PeopleColumnDefinition[];
  visible: readonly PeopleColumnId[];
  onChange: (columns: PeopleColumnId[]) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button className="h-9" type="button" variant="secondary">
        <Columns3Icon aria-hidden />
        <span className="sr-only md:not-sr-only">Columnas</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="grid w-60 gap-1 p-2">
      <p className="text-muted-foreground px-2 py-1 text-xs">
        Nombre siempre se muestra.
      </p>
      {allowed.map((column) => {
        const id = `columna-${column.id}`;
        const checked = visible.includes(column.id);

        return (
          <div
            className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5"
            key={column.id}
          >
            <Checkbox
              checked={checked}
              id={id}
              onCheckedChange={(next) =>
                onChange(
                  // Keep the registry order so a view reads the same everywhere.
                  allowed
                    .map((item) => item.id)
                    .filter((item) =>
                      item === column.id
                        ? next === true
                        : visible.includes(item),
                    ),
                )
              }
            />
            <Label className="flex-1 text-sm font-normal" htmlFor={id}>
              {column.label}
            </Label>
          </div>
        );
      })}
    </PopoverContent>
  </Popover>
);

/**
 * «Exportar (N)»: the file has the N people of the list, with its filter and
 * its visible columns; the route checks the permissions again.
 */
export const PeopleExportButton = ({
  filter,
  columns,
  total,
}: {
  filter: PeopleFilter;
  columns: readonly PeopleColumnId[];
  total: number;
}) => {
  const query = peopleFilterQueryString(filter);
  const href = (extra: Record<string, string>) =>
    `/app/personas/exportar?${[query, new URLSearchParams(extra).toString()]
      .filter(Boolean)
      .join("&")}`;
  const cols = serializePeopleColumns(columns);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-9"
          data-testid="personas-exportar"
          disabled={total === 0}
          type="button"
        >
          <DownloadIcon aria-hidden />
          Exportar ({total.toLocaleString("es-MX")})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Las {total.toLocaleString("es-MX")} personas de la lista, con sus
          columnas visibles.
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a download href={href({ cols, format: "xlsx" })}>
            <FileSpreadsheetIcon aria-hidden />
            Excel
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a download href={href({ cols, format: "csv" })}>
            <DownloadIcon aria-hidden />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a download href={href({ format: "xlsx" })}>
            <FileSpreadsheetIcon aria-hidden />
            Formato de importación (Excel)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
