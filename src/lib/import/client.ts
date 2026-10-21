import { parseCsv } from "./csv";
import {
  EXAMPLE_SHEET_NAME,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  IMPORT_SHEETS,
  SHEET_NAMES,
  mapHeaders,
  normalizeHeader,
  parseImportDate,
  parseImportTime,
  type HeaderMapping,
  type ImportSheetKey,
} from "./format";

/**
 * Browser-side reading of import files. Nothing here touches the server or the
 * DOM, so it is unit-testable; the XLSX reader is injected (the app passes
 * `read-excel-file/browser`, which parses in a Web Worker).
 */

export type RawCell = string | number | boolean | Date | null | undefined;
export type RawSheet = { name: string; data: RawCell[][] };
export type ReadWorkbook = (file: Blob) => Promise<RawSheet[]>;

export type ParsedRow = {
  /** 1-based row number in the source sheet, header included. */
  rowNumber: number;
  /** Values keyed by import column key. */
  cells: Record<string, string | number | boolean | null>;
};

export type ParsedSheet = {
  sheet: ImportSheetKey;
  sourceName: string;
  headers: string[];
  mapping: HeaderMapping;
  rows: ParsedRow[];
  /** Kept so the user can correct the mapping and re-apply it. */
  raw: RawSheet;
};

export type ParsedImportFile = {
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  sheets: ParsedSheet[];
  totalRows: number;
};

export class ImportFileError extends Error {
  constructor(
    public readonly code:
      | "too_large"
      | "unsupported"
      | "empty"
      | "no_personas_sheet"
      | "too_many_rows"
      | "duplicate_headers",
    message: string,
  ) {
    super(message);
    this.name = "ImportFileError";
  }
}

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

export const checkImportFile = (file: { name: string; size: number }) => {
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    throw new ImportFileError(
      "too_large",
      `El archivo pesa más de ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB.`,
    );
  }

  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    throw new ImportFileError(
      "unsupported",
      "Sube un archivo .xlsx o .csv (usa la plantilla).",
    );
  }
};

export const hashFile = async (blob: Blob) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/** Matches workbook sheets to import sheets by name (accent/case-insensitive). */
const matchSheets = (sheets: RawSheet[], isCsv: boolean) => {
  if (isCsv) {
    return new Map<ImportSheetKey, RawSheet>([["personas", sheets[0]]]);
  }

  const matched = new Map<ImportSheetKey, RawSheet>();

  for (const key of IMPORT_SHEETS) {
    const wanted = normalizeHeader(SHEET_NAMES[key]);
    const found = sheets.find(
      (sheet) => normalizeHeader(sheet.name) === wanted,
    );

    if (found) {
      matched.set(key, found);
    }
  }

  // A single-sheet workbook with another name is read as Personas, unless it
  // is the template's sample sheet: its fictional rows are never imported.
  if (
    !matched.has("personas") &&
    sheets.length === 1 &&
    normalizeHeader(sheets[0].name) !== normalizeHeader(EXAMPLE_SHEET_NAME)
  ) {
    matched.set("personas", sheets[0]);
  }

  return matched;
};

const headerLabel = (cell: RawCell) =>
  cell instanceof Date ? cell.toISOString() : String(cell ?? "").trim();

const convertCell = (
  key: ImportSheetKey,
  columnKey: string,
  value: RawCell,
): string | number | boolean | null => {
  if (isEmpty(value)) {
    return null;
  }

  const kind = IMPORT_COLUMNS[key].find(
    (column) => column.key === columnKey,
  )?.kind;

  if (kind === "date") {
    // Unparseable dates stay as text so validation can report the real value.
    return (
      parseImportDate(value) ??
      (value instanceof Date ? value.toISOString() : String(value).trim())
    );
  }

  if (kind === "time") {
    return (
      parseImportTime(value) ??
      (value instanceof Date ? value.toISOString() : String(value).trim())
    );
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value.trim() : (value as number | boolean);
};

/**
 * Turns a raw sheet into keyed rows with a (possibly user-corrected) mapping.
 * Empty rows are skipped but row numbers still match the spreadsheet.
 */
export const applyMapping = (
  key: ImportSheetKey,
  data: RawCell[][],
  mapped: Record<number, string>,
): ParsedRow[] => {
  const rows: ParsedRow[] = [];

  for (let index = 1; index < data.length; index += 1) {
    const source = data[index];
    const cells: ParsedRow["cells"] = {};
    let hasValue = false;

    for (const [position, columnKey] of Object.entries(mapped)) {
      const value = convertCell(key, columnKey, source[Number(position)]);

      cells[columnKey] = value;
      hasValue ||= value !== null;
    }

    if (hasValue) {
      rows.push({ rowNumber: index + 1, cells });
    }
  }

  return rows;
};

export const parseSheet = (
  key: ImportSheetKey,
  raw: RawSheet,
  mappingOverride?: Record<number, string>,
): ParsedSheet => {
  const data = raw.data;
  const headers = (data[0] ?? []).map(headerLabel);

  if (data.length === 0 || headers.every((header) => header === "")) {
    throw new ImportFileError("empty", `La hoja ${raw.name} está vacía.`);
  }

  const mapping = mapHeaders(key, headers);

  if (!mappingOverride && mapping.duplicates.length > 0) {
    const names = mapping.duplicates.map((d) => `"${d.header}"`).join(", ");

    throw new ImportFileError(
      "duplicate_headers",
      `La hoja ${raw.name} repite columnas: ${names}.`,
    );
  }

  const mapped = mappingOverride ?? mapping.mapped;

  return {
    sheet: key,
    sourceName: raw.name,
    headers,
    mapping,
    rows: applyMapping(key, data, mapped),
    raw,
  };
};

/**
 * Reads, checks and maps a whole file. Missing required columns are not an
 * error here: `sheet.mapping.missingRequired` lets the wizard ask the user to
 * map them by hand and call `parseSheet` again with an override.
 */
export const parseImportFile = async (
  file: File,
  readWorkbook: ReadWorkbook,
): Promise<ParsedImportFile> => {
  checkImportFile(file);

  const isCsv = /\.csv$/i.test(file.name);
  const [fileHash, rawSheets] = await Promise.all([
    hashFile(file),
    isCsv
      ? file.text().then((text) => [{ name: "Personas", data: parseCsv(text) }])
      : readWorkbook(file),
  ]);

  const matched = matchSheets(rawSheets, isCsv);

  if (!matched.has("personas")) {
    throw new ImportFileError(
      "no_personas_sheet",
      "No encontramos la hoja Personas. Usa la plantilla de Workia.",
    );
  }

  const sheets = [...matched.entries()].map(([key, raw]) =>
    parseSheet(key, raw),
  );
  const personas = sheets.find((sheet) => sheet.sheet === "personas")!;

  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  // A corrected error report may only carry rows for Horarios or Contratos.
  if (totalRows === 0) {
    throw new ImportFileError(
      "empty",
      "El archivo no tiene filas para importar.",
    );
  }

  if (personas.rows.length > IMPORT_LIMITS.maxRows) {
    throw new ImportFileError(
      "too_many_rows",
      `El archivo tiene ${personas.rows.length.toLocaleString("es-MX")} personas; el máximo es ${IMPORT_LIMITS.maxRows.toLocaleString("es-MX")}. Divídelo en varios archivos.`,
    );
  }

  for (const sheet of sheets) {
    const max = IMPORT_LIMITS.maxRowsPerSheet[sheet.sheet];

    if (sheet.sheet !== "personas" && sheet.rows.length > max) {
      throw new ImportFileError(
        "too_many_rows",
        `La hoja ${SHEET_NAMES[sheet.sheet]} tiene ${sheet.rows.length.toLocaleString("es-MX")} filas; el máximo es ${max.toLocaleString("es-MX")}. Divídela en varios archivos.`,
      );
    }
  }

  return {
    fileName: file.name,
    fileHash,
    fileSizeBytes: file.size,
    sheets,
    totalRows,
  };
};

export const chunkRows = <T>(
  rows: readonly T[],
  size: number = IMPORT_LIMITS.chunkRows,
): T[][] => {
  const chunks: T[][] = [];

  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }

  return chunks;
};
