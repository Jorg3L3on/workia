import ExcelJS from "exceljs";

import type { Cell, PrenominaSheet } from "./rows";
import type { PrenominaTemplateConfig } from "./template";

/**
 * The pre-nómina file itself (W2-18), from the rows: CSV with the template's
 * delimiter and encoding, or an Excel sheet. A quincena of a company is at
 * most a few thousand rows, so the file is built in memory.
 */

export const PRENOMINA_CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
} as const;

const BOM = String.fromCharCode(0xfeff);

const csvCell = (value: Cell, delimiter: string) => {
  const text = String(value);

  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
};

export const renderCsv = (
  sheet: Pick<PrenominaSheet, "header" | "rows">,
  template: Pick<PrenominaTemplateConfig, "delimiter" | "encoding">,
): Buffer => {
  const lines = [...(sheet.header ? [sheet.header] : []), ...sheet.rows].map(
    (row) =>
      row
        .map((cell) => csvCell(cell, template.delimiter))
        .join(template.delimiter) + "\r\n",
  );
  const text = lines.join("");

  switch (template.encoding) {
    case "utf8_bom":
      return Buffer.from(`${BOM}${text}`, "utf8");
    case "utf8":
      return Buffer.from(text, "utf8");
    case "latin1":
      // Spanish letters are in Latin-1; anything else would come out as a
      // different letter, so it becomes "?".
      return Buffer.from(text.replace(/[^\u0000-ÿ]/g, "?"), "latin1");
  }
};

export const renderXlsx = async (
  sheet: Pick<PrenominaSheet, "header" | "rows">,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Prenomina");

  if (sheet.header) {
    worksheet.addRow(sheet.header).font = { bold: true };
  }

  for (const row of sheet.rows) {
    worksheet.addRow(row);
  }

  // Identifiers stay text, so a leading zero (NSS, checador) survives.
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "string") cell.numFmt = "@";
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const renderPrenominaFile = async (
  sheet: Pick<PrenominaSheet, "header" | "rows">,
  template: Pick<PrenominaTemplateConfig, "format" | "delimiter" | "encoding">,
) =>
  template.format === "csv" ? renderCsv(sheet, template) : renderXlsx(sheet);

export const prenominaContentType = (
  template: Pick<PrenominaTemplateConfig, "format" | "encoding">,
) =>
  template.format === "csv"
    ? `${PRENOMINA_CONTENT_TYPES.csv}; charset=${template.encoding === "latin1" ? "iso-8859-1" : "utf-8"}`
    : PRENOMINA_CONTENT_TYPES.xlsx;
