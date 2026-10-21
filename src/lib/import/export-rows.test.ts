import { describe, expect, it } from "vitest";

import {
  CSV_BOM,
  contractExportRow,
  csvLine,
  formatExportDate,
  orderedValues,
  personExportRow,
  type ExportPerson,
} from "./export-rows";
import { exportHeaders } from "./export-rows";
import { IMPORT_COLUMNS, mapHeaders, parseImportDate } from "./format";

const person: ExportPerson = {
  id: "11111111-1111-4111-8111-111111111111",
  nombres: "Ana",
  apellidoPaterno: "López",
  apellidoMaterno: null,
  email: null,
  telefono: null,
  fechaNacimiento: "1990-03-05",
  fechaIngreso: null,
  areaName: "Ventas",
  positionName: null,
  siteName: null,
  managerId: "22222222-2222-4222-8222-222222222222",
  managerCurp: null,
  rfc: null,
  curp: "HEGG560427MVZRRL04",
  nss: null,
  status: "baja",
};

describe("export rows", () => {
  it("writes readable dates that the importer parses back to the same value", () => {
    expect(formatExportDate("1990-03-05")).toBe("05/03/1990");
    expect(parseImportDate(formatExportDate("1990-03-05"))).toBe("1990-03-05");
    expect(formatExportDate(null)).toBe("");
  });

  it("uses the import headers and column order", () => {
    const values = orderedValues("personas", personExportRow(person));

    expect(values).toHaveLength(IMPORT_COLUMNS.personas.length);
    // ID Workia is the last column, so new rows can leave it empty.
    expect(values.at(-1)).toBe(person.id);
    expect(mapHeaders("personas", exportHeaders("personas")).unknown).toEqual(
      [],
    );
  });

  it("falls back to the manager's ID Workia when the manager has no CURP", () => {
    expect(personExportRow(person).jefeDirecto).toBe(person.managerId);
    expect(
      personExportRow({ ...person, managerCurp: "CURP1" }).jefeDirecto,
    ).toBe("CURP1");
  });

  it("labels contract enums like the template dropdowns", () => {
    const row = contractExportRow(
      {
        personId: person.id,
        type: "determinado",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        noticeWindow: "no_avisar",
        status: "no_renovado",
        templateName: null,
      },
      person,
    );

    expect(row).toMatchObject({
      tipo: "Determinado",
      aviso: "No avisar",
      estatus: "No renovado",
      fechaFin: "31/12/2024",
    });
  });
});

describe("csvLine", () => {
  it("quotes commas, quotes and newlines and ends with CRLF", () => {
    expect(csvLine(["a", 'b,"c"', "d\ne"])).toBe('a,"b,""c""","d\ne"\r\n');
    expect(CSV_BOM).toBe("﻿");
  });
});
