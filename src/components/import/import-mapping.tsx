"use client";

import {
  IMPORT_COLUMNS,
  SHEET_NAMES,
  type ImportSheetKey,
} from "@/lib/import/format";
import type { ParsedSheet } from "@/lib/import/client";

type Props = {
  sheets: ParsedSheet[];
  /** Position -> column key, as currently mapped (proposal or user's correction). */
  mappings: Partial<Record<ImportSheetKey, Record<number, string>>>;
  onChange: (
    sheet: ImportSheetKey,
    position: number,
    columnKey: string,
  ) => void;
};

const NONE = "";

export const missingRequired = (
  sheet: ImportSheetKey,
  mapped: Record<number, string>,
) => {
  const used = new Set(Object.values(mapped));

  return IMPORT_COLUMNS[sheet].filter(
    (column) => column.required && !used.has(column.key),
  );
};

export const duplicateTargets = (mapped: Record<number, string>) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const key of Object.values(mapped)) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }

  return duplicates;
};

/** One table per sheet: file header -> Workia column, correctable by hand. */
export const ImportMapping = ({ sheets, mappings, onChange }: Props) => (
  <div className="flex flex-col gap-6">
    {sheets.map((sheet) => {
      const mapped = mappings[sheet.sheet] ?? sheet.mapping.mapped;
      const columns = IMPORT_COLUMNS[sheet.sheet];
      const missing = missingRequired(sheet.sheet, mapped);
      const duplicates = duplicateTargets(mapped);

      return (
        <section
          aria-labelledby={`map-${sheet.sheet}`}
          className="bg-card ring-foreground/10 rounded-lg p-4 ring-1"
          key={sheet.sheet}
        >
          <h3 className="text-base font-semibold" id={`map-${sheet.sheet}`}>
            Hoja {SHEET_NAMES[sheet.sheet]}{" "}
            <span className="text-muted-foreground text-sm font-normal">
              ({sheet.rows.length.toLocaleString("es-MX")} filas)
            </span>
          </h3>

          {missing.length > 0 ? (
            <p className="text-destructive mt-2 text-sm" role="alert">
              Falta asignar: {missing.map((column) => column.label).join(", ")}.
            </p>
          ) : null}
          {duplicates.size > 0 ? (
            <p className="text-destructive mt-2 text-sm" role="alert">
              Dos columnas del archivo apuntan al mismo campo; elige solo una.
            </p>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-4 font-medium" scope="col">
                    Columna del archivo
                  </th>
                  <th className="py-2 pr-4 font-medium" scope="col">
                    Ejemplo
                  </th>
                  <th className="py-2 font-medium" scope="col">
                    Campo en Workia
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheet.headers.map((header, position) =>
                  header === "" ? null : (
                    <tr className="border-b last:border-0" key={position}>
                      <td className="py-2 pr-4 font-medium">{header}</td>
                      <td className="text-muted-foreground max-w-48 truncate py-2 pr-4">
                        {String(sheet.raw.data[1]?.[position] ?? "—")}
                      </td>
                      <td className="py-2">
                        <label
                          className="sr-only"
                          htmlFor={`m-${sheet.sheet}-${position}`}
                        >
                          Campo para {header}
                        </label>
                        <select
                          className="border-input bg-background h-8 w-full max-w-64 rounded-lg border px-2 text-sm"
                          id={`m-${sheet.sheet}-${position}`}
                          onChange={(event) =>
                            onChange(sheet.sheet, position, event.target.value)
                          }
                          value={mapped[position] ?? NONE}
                        >
                          <option value={NONE}>No importar esta columna</option>
                          {columns.map((column) => (
                            <option key={column.key} value={column.key}>
                              {column.label}
                              {column.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      );
    })}
  </div>
);
