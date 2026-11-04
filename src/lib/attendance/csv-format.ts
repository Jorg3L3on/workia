import { z } from "zod";

import type { AttendanceCsvFormat } from "@/lib/db/schema/attendance";

import { instantFromWallTime, type WallTime } from "./time";

/**
 * How a checador's CSV export is read (W2-12). The checador models in use are
 * not decided, so nothing here assumes one: HR describes the file once per
 * checador (which column holds the number, the date, the time, and whether
 * there is an entrada/salida column) and every upload is read the same way.
 */

export const DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY/MM/DD",
] as const;

export const dateFormatLabels: Record<(typeof DATE_FORMATS)[number], string> = {
  "YYYY-MM-DD": "2026-11-03 (año-mes-día)",
  "DD/MM/YYYY": "03/11/2026 (día/mes/año)",
  "MM/DD/YYYY": "11/03/2026 (mes/día/año)",
  "YYYY/MM/DD": "2026/11/03 (año/mes/día)",
};

const column = z
  .string()
  .trim()
  .min(1, "Indica la columna.")
  .max(60, "El nombre de la columna es muy largo.");

const optionalColumn = z
  .string()
  .trim()
  .max(60, "El nombre de la columna es muy largo.")
  .transform((value) => (value === "" ? null : value))
  .nullish();

const values = z.array(z.string().trim().min(1).max(20)).max(10).optional();

export const csvFormatSchema = z
  .object({
    delimiter: z.enum(["auto", ",", ";", "\t"]),
    headerRows: z.coerce.number().int().min(0).max(5),
    badgeColumn: column,
    dateTimeColumn: optionalColumn,
    dateColumn: optionalColumn,
    timeColumn: optionalColumn,
    dateFormat: z.enum(DATE_FORMATS),
    kindColumn: optionalColumn,
    inValues: values,
    outValues: values,
  })
  .superRefine((format, ctx) => {
    if (!format.dateTimeColumn && !(format.dateColumn && format.timeColumn)) {
      ctx.addIssue({
        code: "custom",
        path: ["dateTimeColumn"],
        message:
          "Indica la columna de fecha y hora, o una columna de fecha y otra de hora.",
      });
    }

    if (
      format.kindColumn &&
      !format.inValues?.length &&
      !format.outValues?.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["inValues"],
        message: "Indica qué valores significan entrada y salida.",
      });
    }

    const named = [
      format.badgeColumn,
      format.dateTimeColumn,
      format.dateColumn,
      format.timeColumn,
      format.kindColumn,
    ].filter((value): value is string => Boolean(value));

    if (
      format.headerRows === 0 &&
      named.some((value) => !/^\d+$/.test(value))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["headerRows"],
        message:
          "Sin fila de encabezado, las columnas se indican por número (1, 2, 3…).",
      });
    }
  });

/** Starting points HR adjusts to the real file; none is a claim about a model. */
export const CSV_FORMAT_PRESETS: Array<{
  id: string;
  label: string;
  format: AttendanceCsvFormat;
}> = [
  {
    id: "generic",
    label: "Número, fecha y hora en una columna, con encabezado",
    format: {
      delimiter: "auto",
      headerRows: 1,
      badgeColumn: "1",
      dateTimeColumn: "2",
      dateFormat: "YYYY-MM-DD",
    },
  },
  {
    id: "split",
    label: "Número, fecha y hora en columnas separadas, con encabezado",
    format: {
      delimiter: "auto",
      headerRows: 1,
      badgeColumn: "1",
      dateColumn: "2",
      timeColumn: "3",
      dateFormat: "DD/MM/YYYY",
    },
  },
  {
    id: "attlog",
    label: "Registro de checadas separado por tabuladores, sin encabezado",
    format: {
      delimiter: "\t",
      headerRows: 0,
      badgeColumn: "1",
      dateTimeColumn: "2",
      dateFormat: "YYYY-MM-DD",
      kindColumn: "4",
      inValues: ["0"],
      outValues: ["1"],
    },
  },
];

export const DEFAULT_CSV_FORMAT = CSV_FORMAT_PRESETS[0].format;

export type CsvPunch = {
  line: number;
  raw: string[];
  badge: string;
  at: Date;
  kind: "in" | "out" | null;
};

export type CsvInvalid = { line: number; raw: string[]; error: string };

/**
 * A person's number as stored: trimmed, without leading zeros, so "00123"
 * on one checador and "123" on another are the same person.
 */
export const normalizeBadge = (value: string) =>
  value.trim().replace(/^0+(?=\d)/, "");

const clean = (value: string | undefined) =>
  (value ?? "").replace(/^\s+|\s+$/g, "");

/** A column reference: a 1-based number, or a header name (any case, any spacing). */
const resolveColumn = (reference: string, header: string[] | null) => {
  if (/^\d+$/.test(reference)) {
    const index = Number(reference) - 1;

    return index >= 0 ? index : -1;
  }

  if (!header) return -1;

  const wanted = reference.trim().toLowerCase().replace(/\s+/g, " ");

  return header.findIndex(
    (name) => name.trim().toLowerCase().replace(/\s+/g, " ") === wanted,
  );
};

const DATE_PATTERNS: Record<(typeof DATE_FORMATS)[number], RegExp> = {
  "YYYY-MM-DD": /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/,
  "YYYY/MM/DD": /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/,
  "DD/MM/YYYY": /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/,
  "MM/DD/YYYY": /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/,
};

const parseDate = (value: string, format: (typeof DATE_FORMATS)[number]) => {
  const match = DATE_PATTERNS[format].exec(value);

  if (!match) return null;

  const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];

  switch (format) {
    case "YYYY-MM-DD":
    case "YYYY/MM/DD":
      return { year: a, month: b, day: c };
    case "DD/MM/YYYY":
      return { year: c, month: b, day: a };
    case "MM/DD/YYYY":
      return { year: c, month: a, day: b };
  }
};

/** 8:05, 08:05:09, 8:05 p. m., 08:05:09PM. */
const parseTime = (value: string) => {
  const match =
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap])?\.?\s*(?:m\.?)?$/i.exec(
      value.trim(),
    );

  if (!match) return null;

  let hour = Number(match[1]);
  const meridiem = match[4]?.toLowerCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "a" && hour === 12) hour = 0;
    if (meridiem === "p" && hour !== 12) hour += 12;
  }

  return {
    hour,
    minute: Number(match[2]),
    second: match[3] ? Number(match[3]) : 0,
  };
};

const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * A date and time as the checador printed it. A value with an offset or Z is
 * an instant already; anything else is the local time of the site.
 */
export const parsePunchTime = (
  dateText: string,
  timeText: string | null,
  format: (typeof DATE_FORMATS)[number],
): Date | null => {
  if (timeText === null && OFFSET.test(dateText) && dateText.includes("T")) {
    const instant = new Date(dateText);

    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  let datePart = dateText;
  let timePart = timeText;

  if (timePart === null) {
    const split = /^(\S+)[T\s]+(.+)$/.exec(dateText.trim());

    if (!split) return null;

    datePart = split[1];
    timePart = split[2];
  }

  const date = parseDate(datePart.trim(), format);
  const time = parseTime(timePart);

  if (!date || !time) return null;

  return instantFromWallTime({ ...date, ...time } satisfies WallTime);
};

const normalizeValue = (value: string) => value.trim().toLowerCase();

/** The longest raw row kept for HR: enough to recognize it, small for the database. */
const MAX_RAW_CELLS = 16;
const MAX_RAW_CELL = 60;

export const trimRaw = (cells: string[]) =>
  cells
    .slice(0, MAX_RAW_CELLS)
    .map((cell) =>
      cell.length > MAX_RAW_CELL ? cell.slice(0, MAX_RAW_CELL) : cell,
    );

/** Splits a CSV with a fixed or detected delimiter (RFC 4180 quotes, CRLF, BOM). */
export const splitCsv = (
  input: string,
  delimiter: AttendanceCsvFormat["delimiter"],
) => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const separator =
    delimiter !== "auto"
      ? delimiter
      : (["\t", ";", ","] as const).reduce((best, candidate) =>
          firstLine.split(candidate).length > firstLine.split(best).length
            ? candidate
            : best,
        );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

/**
 * Reads a checador export with its format. Blank lines are skipped; a line
 * that does not read is returned with its raw cells and why, never dropped.
 */
export const readChecadorCsv = (
  text: string,
  format: AttendanceCsvFormat,
): { punches: CsvPunch[]; invalid: CsvInvalid[]; rows: number } => {
  const lines = splitCsv(text, format.delimiter);
  const header =
    format.headerRows > 0 ? (lines[format.headerRows - 1] ?? null) : null;
  const index = {
    badge: resolveColumn(format.badgeColumn, header),
    dateTime: format.dateTimeColumn
      ? resolveColumn(format.dateTimeColumn, header)
      : -1,
    date: format.dateColumn ? resolveColumn(format.dateColumn, header) : -1,
    time: format.timeColumn ? resolveColumn(format.timeColumn, header) : -1,
    kind: format.kindColumn ? resolveColumn(format.kindColumn, header) : -1,
  };
  const inValues = new Set((format.inValues ?? []).map(normalizeValue));
  const outValues = new Set((format.outValues ?? []).map(normalizeValue));
  const punches: CsvPunch[] = [];
  const invalid: CsvInvalid[] = [];
  let rows = 0;

  const missing =
    index.badge < 0 ||
    (format.dateTimeColumn
      ? index.dateTime < 0
      : index.date < 0 || index.time < 0) ||
    (format.kindColumn ? index.kind < 0 : false);

  for (let i = format.headerRows; i < lines.length; i += 1) {
    const cells = lines[i];
    const line = i + 1;

    if (cells.every((cell) => cell.trim() === "")) continue;

    rows += 1;

    if (missing) {
      invalid.push({
        line,
        raw: trimRaw(cells),
        error: "El archivo no tiene las columnas del formato del checador.",
      });
      continue;
    }

    const badge = normalizeBadge(clean(cells[index.badge]));

    if (!badge || badge.length > 40) {
      invalid.push({
        line,
        raw: trimRaw(cells),
        error: "Falta el número de la persona.",
      });
      continue;
    }

    const at = format.dateTimeColumn
      ? parsePunchTime(clean(cells[index.dateTime]), null, format.dateFormat)
      : parsePunchTime(
          clean(cells[index.date]),
          clean(cells[index.time]),
          format.dateFormat,
        );

    if (!at) {
      invalid.push({
        line,
        raw: trimRaw(cells),
        error: "La fecha u hora no se puede leer con el formato del checador.",
      });
      continue;
    }

    let kind: CsvPunch["kind"] = null;

    if (format.kindColumn) {
      const value = normalizeValue(cells[index.kind] ?? "");

      kind = inValues.has(value) ? "in" : outValues.has(value) ? "out" : null;
    }

    punches.push({ line, raw: trimRaw(cells), badge, at, kind });
  }

  return { punches, invalid, rows };
};
