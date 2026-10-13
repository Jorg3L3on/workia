import ExcelJS from "exceljs";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { importRows } from "@/lib/db/schema";

import {
  IMPORT_COLUMNS,
  IMPORT_SHEETS,
  SHEET_NAMES,
  type ImportSheetKey,
} from "./format";

export const ERRORS_COLUMN_LABEL = "Errores";

type ErrorRow = {
  sheet: string;
  rowNumber: number;
  raw: Record<string, unknown>;
  errors: { field?: string; message: string }[] | null;
};

/** Builds the workbook of rows that failed validation, plus an Errores column. */
export const buildErrorReportWorkbook = (rows: ErrorRow[]) => {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Workia";

  // Every sheet is present so the corrected file parses like a normal import.
  for (const key of IMPORT_SHEETS) {
    const columns = IMPORT_COLUMNS[key];
    const sheet = workbook.addWorksheet(SHEET_NAMES[key]);

    sheet.columns = [
      ...columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: column.width,
      })),
      { header: ERRORS_COLUMN_LABEL, key: "__errors", width: 60 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of rows.filter((candidate) => candidate.sheet === key)) {
      sheet.addRow({
        ...Object.fromEntries(
          columns.map((column) => [column.key, row.raw[column.key] ?? null]),
        ),
        __errors: (row.errors ?? []).map((error) => error.message).join(" | "),
      });
    }
  }

  return workbook;
};

export const loadErrorRows = async (
  companyId: string,
  jobId: string,
): Promise<ErrorRow[]> =>
  db
    .select({
      sheet: importRows.sheet,
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
      errors: importRows.errors,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.action, "error"),
      ),
    )
    .orderBy(asc(importRows.sheet), asc(importRows.rowNumber));

export const buildErrorReport = async (companyId: string, jobId: string) => {
  const rows = await loadErrorRows(companyId, jobId);

  return {
    count: rows.length,
    file: await buildErrorReportWorkbook(rows).xlsx.writeBuffer(),
  };
};

export type { ImportSheetKey };
