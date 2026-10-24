import { PassThrough } from "node:stream";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { turnoverSheets, writeTurnoverExport } from "./export";
import { buildTurnoverReport } from "./report";
import { turnoverFilterSchema, type TurnoverFact } from "./schema";

const labels = {
  areas: { a1: "Almacén" },
  sites: {},
  positions: {},
  managers: {},
  reportsOf: {},
};

/** Two made-up periods: one baja of the range, one still active. */
const facts: TurnoverFact[] = [
  {
    id: "p1",
    personId: "x1",
    personName: "Persona Ficticia",
    fechaIngreso: "2026-01-05",
    fechaBaja: "2026-03-20",
    bajaSinFecha: false,
    fechaBajaInferida: false,
    requiereRevision: false,
    tipoBaja: "termino_contrato",
    motivoId: "m1",
    motivoName: "No aprobó el periodo de prueba",
    motivoClassification: "involuntaria",
    recontratable: false,
    areaId: "a1",
    siteId: null,
    positionId: null,
    managerId: null,
    firstOfPerson: true,
    previousRecontratable: null,
    hasLaterPeriod: false,
  },
  {
    id: "p2",
    personId: "x2",
    personName: "Otra Ficticia",
    fechaIngreso: "2020-01-01",
    fechaBaja: null,
    bajaSinFecha: false,
    fechaBajaInferida: false,
    requiereRevision: false,
    tipoBaja: null,
    motivoId: null,
    motivoName: null,
    motivoClassification: null,
    recontratable: null,
    areaId: "a1",
    siteId: null,
    positionId: null,
    managerId: null,
    firstOfPerson: true,
    previousRecontratable: null,
    hasLaterPeriod: false,
  },
];

const sheetsWith = (
  finiquitos: Parameters<typeof turnoverSheets>[2]["finiquitos"],
) =>
  turnoverSheets(
    buildTurnoverReport(
      facts,
      turnoverFilterSchema.parse({ from: "2026-01-01", to: "2026-03-31" }),
      {
        labels,
        goal: null,
        today: "2026-06-01",
        unclassifiedReasons: 0,
        withDetail: true,
      },
    ),
    labels,
    {
      companyName: "Empresa Ficticia",
      filterText: "",
      generatedAt: "01/06/2026 10:00",
      finiquitos,
    },
  );

describe("turnover export", () => {
  it("has no payroll column or total without compensation:read", () => {
    const sheets = sheetsWith(null);
    const bajas = sheets.find((sheet) => sheet.name === "Bajas")!;
    const resumen = sheets.find((sheet) => sheet.name === "Resumen")!;

    expect(bajas.rows[0]).not.toContain("Monto del finiquito");
    expect(resumen.rows.flat()).not.toContain("Finiquito pagado en el periodo");
    expect(bajas.rows[1]).toEqual(
      expect.arrayContaining([
        "Persona Ficticia",
        75,
        "Sí",
        "No aprobó el periodo de prueba",
        "Involuntaria",
        "Almacén",
      ]),
    );
  });

  it("adds the finiquito and the paid total with compensation:read", () => {
    const sheets = sheetsWith([
      { periodId: "p1", estado: "pagado", fecha: "2026-03-25", monto: 5000 },
    ]);
    const resumen = sheets.find((sheet) => sheet.name === "Resumen")!;

    expect(sheets.find((sheet) => sheet.name === "Bajas")!.rows[1]).toContain(
      5000,
    );
    expect(resumen.rows).toContainEqual([
      "Finiquito pagado en el periodo",
      5000,
    ]);
  });

  it("writes the CSV with only the bajas and the Excel with every sheet", async () => {
    const sheets = sheetsWith(null);
    const csv = new PassThrough();
    const chunks: Buffer[] = [];
    csv.on("data", (chunk: Buffer) => chunks.push(chunk));

    expect(await writeTurnoverExport(csv, "csv", sheets)).toBe(1);
    expect(Buffer.concat(chunks).toString("utf8")).toContain(
      "Persona Ficticia",
    );

    const xlsx = new PassThrough();
    const parts: Buffer[] = [];
    xlsx.on("data", (chunk: Buffer) => parts.push(chunk));
    await writeTurnoverExport(xlsx, "xlsx", sheets);
    const workbook = new ExcelJS.Workbook();
    const file = Buffer.concat(parts);
    await workbook.xlsx.load(
      file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer,
    );

    expect(workbook.worksheets).toHaveLength(8);
  });
});
