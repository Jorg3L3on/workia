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

  it("writes the baja of someone de baja and Fecha de antigüedad, never the finiquito", () => {
    const employment = {
      abierto: false,
      fechaAntiguedad: "2015-06-01",
      fechaBaja: "2025-11-28",
      tipoBaja: "termino_contrato" as const,
      motivoBaja: "Fin de contrato o proyecto",
      comentarioBaja: "Cerró la obra.",
      recontratable: false,
    };
    const row = personExportRow(person, {
      ...employment,
      // Extra fields of the summary are ignored.
      ...({ finiquitoMonto: "12345.00" } as object),
    });

    expect(row).toMatchObject({
      fechaAntiguedad: "01/06/2015",
      fechaBaja: "28/11/2025",
      tipoBaja: "Término de contrato",
      motivoBaja: "Fin de contrato o proyecto",
      comentarioBaja: "Cerró la obra.",
      recontratable: "No",
    });
    expect(Object.values(row)).not.toContain("12345.00");
    expect(
      IMPORT_COLUMNS.personas.some((column) => /finiquito/i.test(column.key)),
    ).toBe(false);

    // An active person (or an open period) carries no baja columns.
    const active = personExportRow(
      { ...person, status: "activa" },
      { ...employment, abierto: true, fechaBaja: null },
    );

    expect(active).toMatchObject({
      fechaAntiguedad: "01/06/2015",
      fechaBaja: "",
      tipoBaja: "",
      motivoBaja: "",
      recontratable: "",
    });
    // Without periods: empty cells, not "undefined".
    expect(orderedValues("personas", personExportRow(person))).not.toContain(
      "undefined",
    );
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
