import type { PassThrough } from "node:stream";

import ExcelJS from "exceljs";

import { formatDateMx } from "@/lib/format/date";
import { CSV_BOM, csvLine } from "@/lib/import/export-rows";

import type { ReportRow } from "../absenteeism/report";
import { MIN_GROUP_HEADCOUNT } from "../turnover/metrics";

import type { GroupDashboard } from "./report";

type Cell = string | number;

/** The header row of the table: row 6 of Resumen, row 1 of the CSV. */
export const GROUP_HEADER_ROW = 6;

const pct = (value: number | null) =>
  value === null ? "" : Math.round(value * 10) / 10;

const TABLE_HEADER = [
  "Nivel",
  "Empresa",
  "Región",
  "Sucursal",
  "Plantilla promedio",
  "Ingresos",
  "Bajas",
  "Voluntarias",
  "Involuntarias",
  "Rotación %",
  "Rotación voluntaria %",
  "Días con asistencia",
  "Faltas",
  "Faltas justificadas",
  "Ausentismo %",
  "Días con retardo",
  "Minutos de retardo",
  "Traslados internos (salidas)",
  "Traslados internos (llegadas)",
];

const DEFINITIONS: [string, string][] = [
  [
    "Empresa, región y sucursal",
    "Los mismos números que «Ausentismo y rotación» de cada empresa para el mismo periodo, sin filtros de región ni sucursal.",
  ],
  [
    "Grupo",
    "Se calcula con los periodos y días de todas las empresas mostradas, nunca como suma ni promedio de tasas.",
  ],
  [
    "Traslados internos",
    "Un traslado entre dos empresas mostradas es baja en una e ingreso en la otra: cuenta en cada empresa, no en el grupo.",
  ],
  [
    "Grupos chicos",
    `Con plantilla promedio menor a ${MIN_GROUP_HEADCOUNT} no se muestra la tasa de rotación; las bajas sí.`,
  ],
];

const tableRow = (
  level: string,
  company: string,
  region: string,
  site: string,
  row: ReportRow,
  transfers: [number, number] | ["", ""] = ["", ""],
): Cell[] => [
  level,
  company,
  region,
  site,
  row.turnover.headcount,
  row.turnover.hires,
  row.turnover.exits,
  row.turnover.voluntaryExits,
  row.turnover.involuntaryExits,
  pct(row.turnover.rate),
  pct(row.turnover.voluntaryRate),
  row.absenteeism.presentDays,
  row.absenteeism.absentDays,
  row.absenteeism.justifiedAbsentDays,
  pct(row.absenteeism.rate),
  row.absenteeism.lateDays,
  row.absenteeism.lateMinutes,
  ...transfers,
];

/** The group, then each company with its regiones and sucursales. */
export const groupTable = (dashboard: GroupDashboard): Cell[][] => [
  TABLE_HEADER,
  tableRow("Grupo", "", "", "", dashboard.total, [
    dashboard.total.transfersOut,
    dashboard.total.transfersIn,
  ]),
  ...dashboard.companies.flatMap((company) => [
    tableRow("Empresa", company.companyName, "", "", company.report.total, [
      company.transfersOut,
      company.transfersIn,
    ]),
    ...company.report.regions.flatMap((region) => [
      tableRow("Región", company.companyName, region.label, "", region),
      ...region.sites.map((site) =>
        tableRow(
          "Sucursal",
          company.companyName,
          region.label,
          site.label,
          site,
        ),
      ),
    ]),
  ]),
];

/**
 * Writes the Excel (Resumen with the table and the definitions) or the CSV
 * (the table) to `stream`; returns the number of table rows. Only counts and
 * rates: no person is named, so reports:read is enough.
 */
export const writeGroupExport = async (
  stream: PassThrough,
  format: "xlsx" | "csv",
  dashboard: GroupDashboard,
  context: { generatedAt: string },
) => {
  const table = groupTable(dashboard);

  if (format === "csv") {
    stream.write(CSV_BOM);
    for (const row of table) stream.write(csvLine(row.map(String)));
    stream.end();

    return table.length - 1;
  }

  const { filter } = dashboard;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Resumen");

  worksheet.addRows([
    ["Tablero del grupo"],
    ["Periodo", `${formatDateMx(filter.from)} – ${formatDateMx(filter.to)}`],
    [
      "Empresas",
      dashboard.companies.map((company) => company.companyName).join(", "),
    ],
    ["Fecha de corte", context.generatedAt],
    [],
    ...table,
    [],
    ["Definición", "Cómo se calcula"],
    ...DEFINITIONS,
  ]);
  worksheet.getRow(GROUP_HEADER_ROW).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.width = 18;
  });

  await workbook.xlsx.write(stream);
  stream.end();

  return table.length - 1;
};
