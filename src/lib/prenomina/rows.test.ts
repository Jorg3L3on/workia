import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { renderCsv, renderXlsx } from "./file";
import {
  buildPrenominaSheet,
  formatDate,
  periodNumber,
  type PrenominaPerson,
  type SnapshotRowInput,
  sumTotals,
  totalsFromSnapshot,
} from "./rows";
import {
  DEFAULT_TEMPLATE,
  prenominaTemplateSchema,
  type PrenominaTemplateConfig,
} from "./template";

const row = (
  personId: string,
  kind: string,
  values: Partial<SnapshotRowInput> = {},
): SnapshotRowInput => ({
  personId,
  kind,
  count: 1,
  justified: 0,
  minutes: 0,
  justifiedMinutes: 0,
  justifiedVacation: 0,
  justifiedPermisoConGoce: 0,
  justifiedPermisoSinGoce: 0,
  justifiedIncapacidad: 0,
  ...values,
});

const person = (
  id: string,
  apellidoPaterno: string,
  values: Partial<PrenominaPerson> = {},
): PrenominaPerson => ({
  id,
  nombres: "Ana",
  apellidoPaterno,
  apellidoMaterno: null,
  curp: `CURP${id}`,
  rfc: null,
  nss: "01234567890",
  checador: "007",
  sucursal: "Centro",
  ...values,
});

const template = (
  values: Partial<PrenominaTemplateConfig>,
): PrenominaTemplateConfig =>
  prenominaTemplateSchema.parse({ ...DEFAULT_TEMPLATE, ...values });

describe("totalsFromSnapshot", () => {
  it("counts unjustified faltas as faltas and justified ones by what justified them", () => {
    const totals = totalsFromSnapshot([
      row("p1", "falta", {
        count: 6,
        justified: 5,
        justifiedVacation: 2,
        justifiedPermisoConGoce: 1,
        justifiedPermisoSinGoce: 1,
        justifiedIncapacidad: 0,
      }),
      row("p1", "retardo", {
        count: 3,
        justified: 1,
        minutes: 50,
        justifiedMinutes: 20,
      }),
      row("p1", "salida_anticipada", { count: 1, minutes: 15 }),
      row("p1", "algo_nuevo", { count: 4 }),
      row("p2", "falta", { count: 1, justified: 1, justifiedIncapacidad: 1 }),
    ]);

    expect(totals.get("p1")).toEqual({
      faltas: 1,
      retardos: 2,
      minutos_retardo: 30,
      salidas_anticipadas: 1,
      minutos_salida: 15,
      permisos_con_goce: 1,
      permisos_sin_goce: 1,
      incapacidades: 0,
      vacaciones: 2,
      faltas_justificadas_rh: 1,
    });
    expect(totals.get("p2")?.incapacidades).toBe(1);
    expect(sumTotals(totals.values())).toMatchObject({
      faltas: 1,
      incapacidades: 1,
      vacaciones: 2,
    });
  });
});

describe("dates and period numbers", () => {
  it("formats the period's days as the template asks", () => {
    expect(formatDate("2026-11-16", "iso")).toBe("2026-11-16");
    expect(formatDate("2026-11-16", "dmy")).toBe("16/11/2026");
    expect(formatDate("2026-11-16", "dmy_dash")).toBe("16-11-2026");
    expect(formatDate("2026-11-16", "ymd_compact")).toBe("20261116");
  });

  it("numbers quincenas 1 to 24 in the year", () => {
    expect(periodNumber("2026-01-Q1")).toBe(1);
    expect(periodNumber("2026-01-Q2")).toBe(2);
    expect(periodNumber("2026-11-Q2")).toBe(22);
    expect(periodNumber("2026-12-Q2")).toBe(24);
  });
});

describe("buildPrenominaSheet", () => {
  const totals = totalsFromSnapshot([
    row("b", "falta", { count: 2, justified: 1, justifiedVacation: 1 }),
    row("a", "retardo", { count: 1, minutes: 12 }),
    row("c", "retardo", {
      count: 1,
      justified: 1,
      minutes: 5,
      justifiedMinutes: 5,
    }),
  ]);
  const people = [
    person("b", "Zamora", { checador: null }),
    person("a", "Álvarez"),
    person("c", "Ortiz"),
  ];
  const period = { period: "2026-11-Q2", revision: 2 };

  it("wide: one row per person in name order, empty people left out", () => {
    const sheet = buildPrenominaSheet(
      template({
        columns: [
          { header: "No", field: "checador" },
          { header: "", field: "faltas" },
          { header: "Vac", field: "vacaciones" },
          { header: "Ret", field: "retardos" },
          { header: "Min", field: "minutos_retardo" },
          { header: "Inicio", field: "fecha_inicio" },
          { header: "Emp", field: "constante", value: "E01" },
        ],
        dateFormat: "dmy",
      }),
      period,
      people,
      totals,
    );

    expect(sheet.header).toEqual([
      "No",
      "FALTAS",
      "Vac",
      "Ret",
      "Min",
      "Inicio",
      "Emp",
    ]);
    expect(sheet.rows).toEqual([
      ["007", 0, 0, 1, 12, "16/11/2026", "E01"],
      ["", 1, 1, 0, 0, "16/11/2026", "E01"],
    ]);
    expect(sheet.people).toBe(2);
    expect(sheet.missing).toEqual([{ field: "checador", people: 1 }]);
  });

  it("wide without skipping keeps a person with nothing to report", () => {
    const sheet = buildPrenominaSheet(
      template({
        skipEmpty: false,
        includeHeader: false,
        columns: [
          { header: "CURP", field: "curp" },
          { header: "F", field: "faltas" },
        ],
      }),
      period,
      people,
      totals,
    );

    expect(sheet.header).toBeNull();
    expect(sheet.rows).toEqual([
      ["CURPa", 0],
      ["CURPc", 0],
      ["CURPb", 1],
    ]);
  });

  it("long: one row per person and concept with a code and a value", () => {
    const sheet = buildPrenominaSheet(
      template({
        layout: "long",
        columns: [
          { header: "NSS", field: "nss" },
          { header: "Periodo", field: "numero_periodo" },
          { header: "Clave", field: "concepto" },
          { header: "Nombre", field: "concepto_nombre" },
          { header: "Valor", field: "cantidad" },
        ],
        conceptCodes: { faltas: "001", vacaciones: "V", minutos_retardo: "" },
      }),
      period,
      people,
      totals,
    );

    expect(sheet.rows).toEqual([
      ["01234567890", 22, "001", "Faltas", 1],
      ["01234567890", 22, "V", "Vacaciones", 1],
    ]);
    expect(sheet.people).toBe(1);
  });
});

describe("prenominaTemplateSchema", () => {
  it("accepts the built-in template", () => {
    expect(prenominaTemplateSchema.safeParse(DEFAULT_TEMPLATE).success).toBe(
      true,
    );
  });

  it.each([
    [{ layout: "long" }, "concepto"],
    [
      {
        layout: "long",
        columns: [
          { header: "C", field: "concepto" },
          { header: "Q", field: "cantidad" },
        ],
      },
      "clave",
    ],
    [{ columns: [{ header: "CURP", field: "curp" }] }, "incidencias"],
    [
      {
        columns: [
          { header: "C", field: "cantidad" },
          { header: "F", field: "faltas" },
        ],
      },
      "Concepto y cantidad",
    ],
    [{ columns: [{ header: "a\tb", field: "faltas" }] }, "tabuladores"],
    [{ format: "xlsx", encoding: "latin1" }, "CSV"],
    [{ columns: [{ header: "X", field: "salario" }] }, "Campo"],
  ])("refuses %j", (values, message) => {
    const parsed = prenominaTemplateSchema.safeParse({
      ...DEFAULT_TEMPLATE,
      ...values,
    });

    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.map((issue) => issue.message).join(" "),
    ).toMatch(new RegExp(message, "i"));
  });
});

describe("the file", () => {
  const sheet = {
    header: ["Nombre", "Faltas"],
    rows: [
      ['Peña; "Toño"', 2],
      ["Ana", 0],
    ],
  };

  it("CSV quotes what needs it for the delimiter and adds the BOM", () => {
    const text = renderCsv(sheet, {
      delimiter: ";",
      encoding: "utf8_bom",
    }).toString("utf8");

    expect(text).toBe('﻿Nombre;Faltas\r\n"Peña; ""Toño""";2\r\nAna;0\r\n');
  });

  it("CSV in Latin-1 keeps Spanish letters and replaces the rest", () => {
    const body = renderCsv(
      { header: null, rows: [["Peña", "→"]] },
      { delimiter: ",", encoding: "latin1" },
    );

    expect(body.toString("latin1")).toBe("Peña,?\r\n");
    expect(body.length).toBe("Peña,?\r\n".length);
  });

  it("Excel keeps identifiers as text and numbers as numbers", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await renderXlsx({
        header: ["NSS", "F"],
        rows: [["0123", 2]],
      })) as unknown as ArrayBuffer,
    );
    const data = workbook.worksheets[0].getRow(2);

    expect(data.getCell(1).value).toBe("0123");
    expect(data.getCell(2).value).toBe(2);
  });
});
