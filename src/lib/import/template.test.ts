import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  CATALOGS_SHEET_NAME,
  EXAMPLE_SHEET_NAME,
  IMPORT_COLUMNS,
  IMPORT_SHEETS,
  INSTRUCTIONS_SHEET_NAME,
  SHEET_NAMES,
  mapHeaders,
} from "./format";
import { buildImportTemplate } from "./template";

const load = async () => {
  const buffer = await buildImportTemplate(
    {
      areas: ["Ventas", "Almacén"],
      positions: ["Cajero", "Vendedor"],
      sites: ["Matriz"],
      templates: [],
      areaPositions: [
        { area: "Ventas", positions: ["Cajero", "Vendedor"] },
        { area: "Almacén", positions: [] },
      ],
      managers: ["Laura Méndez Ortiz"],
      terminationReasons: ["Renuncia voluntaria", "Jubilación"],
    },
    new Date("2026-10-21T12:00:00Z"),
  );
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  return workbook;
};

describe("buildImportTemplate", () => {
  it("has the six sheets in order", async () => {
    const workbook = await load();

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      INSTRUCTIONS_SHEET_NAME,
      EXAMPLE_SHEET_NAME,
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

  const columnOf = (key: string) =>
    IMPORT_COLUMNS.personas.findIndex((c) => c.key === key) + 1;

  it("styles required headers apart, with a comment, and ID Workia last in grey", async () => {
    const personas = (await load()).getWorksheet(SHEET_NAMES.personas)!;
    const fill = (key: string) =>
      (personas.getCell(1, columnOf(key)).fill as ExcelJS.FillPattern).fgColor
        ?.argb;

    expect(fill("nombres")).toBe(fill("apellidoPaterno"));
    expect(fill("nombres")).not.toBe(fill("email"));
    expect(fill("idWorkia")).not.toBe(fill("email"));
    expect(String(personas.getCell(1, columnOf("nombres")).note)).toContain(
      "Obligatoria",
    );
    expect(String(personas.getCell(1, columnOf("idWorkia")).note)).toContain(
      "Déjalo vacío en altas nuevas",
    );
    expect(IMPORT_COLUMNS.personas.at(-1)?.key).toBe("idWorkia");

    const instructions = (await load()).getWorksheet(INSTRUCTIONS_SHEET_NAME)!;
    const text: string[] = [];

    instructions.eachRow((row) =>
      row.eachCell((cell) => text.push(String(cell.value))),
    );
    expect(text).toContain("Colores de los encabezados");
    expect(text.join(" ")).toContain("Excel en inglés");
    expect(text.join(" ")).toContain("5,000 personas por archivo");
  });

  it("keeps identifiers and phone as text and validates dates", async () => {
    const personas = (await load()).getWorksheet(SHEET_NAMES.personas)!;

    for (const key of ["telefono", "curp", "rfc", "nss"]) {
      expect(personas.getColumn(columnOf(key)).numFmt).toBe("@");
    }

    for (const key of ["fechaNacimiento", "fechaIngreso"]) {
      const rule = personas.getCell(2, columnOf(key)).dataValidation;

      expect(rule).toMatchObject({
        type: "date",
        operator: "between",
        errorStyle: "stop",
      });
      expect((rule.formulae?.[1] as Date).toISOString()).toMatch(/^2027-10-21/);
    }

    const contratos = (await load()).getWorksheet(SHEET_NAMES.contratos)!;
    const start =
      IMPORT_COLUMNS.contratos.findIndex((c) => c.key === "fechaInicio") + 1;

    expect(contratos.getCell(2, start).dataValidation.type).toBe("date");
  });

  it("stops values outside the catalogs and makes Puesto depend on Área", async () => {
    const workbook = await load();
    const personas = workbook.getWorksheet(SHEET_NAMES.personas)!;
    const area = personas.getCell(2, columnOf("area")).dataValidation;
    const position = personas.getCell(2, columnOf("puesto")).dataValidation;
    const manager = personas.getCell(2, columnOf("jefeDirecto")).dataValidation;

    expect(area.errorStyle).toBe("stop");
    expect(position.errorStyle).toBe("stop");
    expect(position.formulae?.[0]).toContain('INDIRECT("PuestosArea_"');
    expect(manager.type).toBe("list");
    // Jefe directo also takes a CURP or ID Workia: the list only suggests.
    expect(manager.showErrorMessage).toBeFalsy();

    const names = workbook.definedNames.model.map((entry) => entry.name);

    expect(names).toEqual(
      expect.arrayContaining(["Areas", "Puestos", "PuestosArea_1"]),
    );
    expect(
      workbook.definedNames.getRanges("PuestosArea_1").ranges[0],
    ).toContain("Catálogos");
  });

  it("shows fictional sample rows in Ejemplo, outside the imported sheets", async () => {
    const example = (await load()).getWorksheet(EXAMPLE_SHEET_NAME)!;
    const headers = (example.getRow(2).values as unknown[]).slice(1);

    expect(String(example.getCell(1, 1).value)).toContain("no se importa");
    expect(headers).toEqual(IMPORT_COLUMNS.personas.map((c) => c.label));
    expect(example.actualRowCount).toBe(6);
    expect(example.getCell(4, columnOf("jefeDirecto")).value).toBe(
      "Laura Méndez Ortiz",
    );
    // One example de baja, with the motivo from the company's catalog.
    expect(example.getCell(6, columnOf("estatus")).value).toBe("Baja");
    expect(example.getCell(6, columnOf("motivoBaja")).value).toBe(
      "Renuncia voluntaria",
    );
    expect(example.getCell(6, columnOf("recontratable")).value).toBe("Sí");
  });

  it("adds the baja columns with dates checked and stop dropdowns", async () => {
    const workbook = await load();
    const personas = workbook.getWorksheet(SHEET_NAMES.personas)!;
    const headers = (personas.getRow(1).values as unknown[]).slice(1);

    expect(headers).toEqual(
      expect.arrayContaining([
        "Fecha de baja",
        "Tipo de baja",
        "Motivo de baja",
        "Comentario de baja",
        "Recontratable",
        "Fecha de antigüedad",
      ]),
    );
    // Optional, and ID Workia stays last.
    expect(
      (personas.getCell(1, columnOf("fechaBaja")).fill as ExcelJS.FillPattern)
        .fgColor?.argb,
    ).toBe(
      (personas.getCell(1, columnOf("email")).fill as ExcelJS.FillPattern)
        .fgColor?.argb,
    );
    expect(headers.at(-1)).toBe("ID Workia");

    for (const key of ["fechaBaja", "fechaAntiguedad"]) {
      expect(personas.getCell(2, columnOf(key)).dataValidation).toMatchObject({
        type: "date",
        errorStyle: "stop",
      });
      expect(personas.getColumn(columnOf(key)).numFmt).toBe("yyyy-mm-dd");
    }

    const catalogs = workbook.getWorksheet(CATALOGS_SHEET_NAME)!;
    const catalogValues = (header: string) => {
      const values: string[] = [];

      catalogs.getRow(1).eachCell((cell, column) => {
        if (cell.value === header) {
          catalogs.getColumn(column).eachCell((entry, row) => {
            if (row > 1 && entry.value) values.push(String(entry.value));
          });
        }
      });

      return values;
    };

    expect(catalogValues("Motivos de baja")).toEqual([
      "Renuncia voluntaria",
      "Jubilación",
    ]);
    expect(catalogValues("Tipo de baja")).toEqual([
      "Voluntaria",
      "Despido",
      "Término de contrato",
      "Otra",
    ]);
    expect(catalogValues("Recontratable")).toEqual(["Sí", "No"]);

    for (const key of ["tipoBaja", "motivoBaja", "recontratable"]) {
      const rule = personas.getCell(2, columnOf(key)).dataValidation;

      expect(rule).toMatchObject({ type: "list", errorStyle: "stop" });
      expect(rule.formulae?.[0]).toContain("Catálogos");
    }

    expect(
      personas.getCell(2, columnOf("motivoBaja")).dataValidation.error,
    ).toContain("Motivos de baja");
    expect(
      personas.getCell(2, columnOf("comentarioBaja")).dataValidation,
    ).toBeFalsy();

    const instructions = workbook.getWorksheet(INSTRUCTIONS_SHEET_NAME)!;
    const text: string[] = [];

    instructions.eachRow((row) =>
      row.eachCell((cell) => text.push(String(cell.value))),
    );
    expect(text).toContain("Bajas y antigüedad");
    expect(text).toContain("Fecha de baja");
    expect(text.join(" ")).toContain("«sin fecha»");
    expect(text.join(" ")).toContain("El finiquito no se importa");
  });
});
