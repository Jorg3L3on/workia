import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  CATALOGS_SHEET_NAME,
  IMPORT_COLUMNS,
  IMPORT_SHEETS,
  INSTRUCTIONS_SHEET_NAME,
  SHEET_NAMES,
  mapHeaders,
} from "./format";
import { buildImportTemplate } from "./template";

const load = async () => {
  const buffer = await buildImportTemplate({
    areas: ["Ventas", "Almacén"],
    positions: ["Cajero", "Vendedor"],
    sites: ["Matriz"],
    templates: [],
  });
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  return workbook;
};

describe("buildImportTemplate", () => {
  it("has the five sheets in order", async () => {
    const workbook = await load();

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      INSTRUCTIONS_SHEET_NAME,
      SHEET_NAMES.personas,
      SHEET_NAMES.horarios,
      SHEET_NAMES.contratos,
      CATALOGS_SHEET_NAME,
    ]);
  });

  it("passes the importer's header validation with no data rows", async () => {
    const workbook = await load();

    for (const key of IMPORT_SHEETS) {
      const sheet = workbook.getWorksheet(SHEET_NAMES[key])!;
      const headers = (sheet.getRow(1).values as unknown[]).slice(1);
      const result = mapHeaders(key, headers);

      expect(headers).toEqual(IMPORT_COLUMNS[key].map((c) => c.label));
      expect(result.unknown).toEqual([]);
      expect(result.duplicates).toEqual([]);
      expect(result.missingRequired).toEqual([]);
      expect(sheet.actualRowCount).toBe(1);
    }
  });

  it("writes catalogs and wires dropdowns to them", async () => {
    const workbook = await load();
    const catalogs = workbook.getWorksheet(CATALOGS_SHEET_NAME)!;

    expect(catalogs.getCell("A2").value).toBe("Ventas");
    expect(catalogs.getCell("B3").value).toBe("Vendedor");

    const personas = workbook.getWorksheet(SHEET_NAMES.personas)!;
    const areaCol = IMPORT_COLUMNS.personas.findIndex((c) => c.key === "area");
    const validation = personas.getCell(2, areaCol + 1).dataValidation;
    const lastRow = personas.getCell(5001, areaCol + 1).dataValidation;

    expect(validation.type).toBe("list");
    expect(validation.formulae?.[0]).toContain("Catálogos");
    expect(lastRow.type).toBe("list");
  });
});
