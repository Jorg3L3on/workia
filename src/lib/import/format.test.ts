import { describe, expect, it } from "vitest";

import {
  IMPORT_COLUMNS,
  mapHeaders,
  normalizeHeader,
  parseContractStatus,
  parseImportDate,
  parseImportTime,
  parseNoticeWindow,
  parsePersonStatus,
} from "./format";

describe("mapHeaders", () => {
  it("maps canonical headers and aliases regardless of accents/case/underscores", () => {
    const result = mapHeaders("personas", [
      "ID Workia",
      "NOMBRES",
      "apellido_paterno",
      "Apellido Paterno ",
      "Área",
      "Jefe directo (CURP)",
      "???",
    ]);

    expect(result.mapped).toMatchObject({
      0: "idWorkia",
      1: "nombres",
      2: "apellidoPaterno",
      4: "area",
      5: "jefeDirecto",
    });
    expect(result.duplicates).toEqual([
      { index: 3, header: "Apellido Paterno", key: "apellidoPaterno" },
    ]);
    expect(result.unknown).toEqual([{ index: 6, header: "???" }]);
    expect(result.missingRequired).toEqual([]);
  });

  it("reports missing required columns", () => {
    expect(mapHeaders("personas", ["Teléfono"]).missingRequired).toEqual([
      "nombres",
      "apellidoPaterno",
    ]);
  });

  it("accepts every canonical label of every sheet", () => {
    for (const sheet of ["personas", "horarios", "contratos"] as const) {
      const labels = IMPORT_COLUMNS[sheet].map((column) => column.label);
      const result = mapHeaders(sheet, labels);

      expect(result.unknown).toEqual([]);
      expect(result.duplicates).toEqual([]);
      expect(result.missingRequired).toEqual([]);
    }
  });

  it("has no alias collisions inside a sheet", () => {
    for (const sheet of ["personas", "horarios", "contratos"] as const) {
      const seen = new Map<string, string>();

      for (const column of IMPORT_COLUMNS[sheet]) {
        for (const name of [column.key, column.label, ...column.aliases]) {
          const key = normalizeHeader(name);
          const owner = seen.get(key);

          expect(owner === undefined || owner === column.key).toBe(true);
          seen.set(key, column.key);
        }
      }
    }
  });
});

describe("parseImportDate", () => {
  it("handles ISO, DD/MM/YYYY, Excel serials and Date objects", () => {
    expect(parseImportDate("2024-03-05")).toBe("2024-03-05");
    expect(parseImportDate("05/03/2024")).toBe("2024-03-05");
    expect(parseImportDate(45356)).toBe("2024-03-05");
    expect(parseImportDate("45356")).toBe("2024-03-05");
    expect(parseImportDate(new Date(Date.UTC(2024, 2, 5)))).toBe("2024-03-05");
  });

  it("rejects impossible or unsupported values", () => {
    expect(parseImportDate("31/02/2024")).toBeNull();
    expect(parseImportDate("mañana")).toBeNull();
    expect(parseImportDate(0)).toBeNull();
    expect(parseImportDate(null)).toBeNull();
  });
});

describe("parseImportTime", () => {
  it("handles text, Excel fractions and seconds", () => {
    expect(parseImportTime("8:00")).toBe("08:00");
    expect(parseImportTime("17:30:00")).toBe("17:30");
    expect(parseImportTime(0.5)).toBe("12:00");
    expect(parseImportTime(0.375)).toBe("09:00");
  });

  it("rejects out-of-range values", () => {
    expect(parseImportTime("24:00")).toBeNull();
    expect(parseImportTime("8am")).toBeNull();
    expect(parseImportTime(1.2)).toBeNull();
  });
});

describe("enum parsers", () => {
  it("map Spanish labels to stored values", () => {
    expect(parsePersonStatus(" Activa ")).toBe("activa");
    expect(parsePersonStatus("baja")).toBe("baja");
    expect(parsePersonStatus("otra")).toBeNull();
    expect(parseNoticeWindow("No avisar")).toBe("no_avisar");
    expect(parseNoticeWindow("3")).toBe("3");
    expect(parseContractStatus("No renovado")).toBe("no_renovado");
  });
});
