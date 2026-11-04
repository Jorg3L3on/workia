import type { PassThrough } from "node:stream";

import ExcelJS from "exceljs";

import { formatDateMx } from "@/lib/format/date";
import { CSV_BOM, csvLine } from "@/lib/import/export-rows";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";

import { MIN_GROUP_HEADCOUNT } from "../turnover/metrics";

import type { AbsenteeismExitRow, AbsenteeismPersonRow } from "./data";
import type {
  AbsenteeismReport,
  RegionInfo,
  ReportRow,
  SiteInfo,
} from "./report";
import { NO_REGION_LABEL, NO_SITE_LABEL } from "./report";

type Cell = string | number;

export type AbsenteeismSheet = { name: string; rows: Cell[][] };

/** The header row of the table sheet: row 6 of Resumen, row 1 of the CSV. */
export const SUMMARY_HEADER_ROW = 6;

const pct = (value: number | null) =>
  value === null ? "" : Math.round(value * 10) / 10;

const DEFINITIONS: [string, string][] = [
  [
    "Rotación",
    "La del reporte de rotación: bajas con fecha en el rango / plantilla promedio × 100. Cada baja cuenta en la sucursal que tenía el periodo al darse de baja.",
  ],
  [
    "Ausentismo",
    "Faltas vigentes / (días con asistencia + faltas) × 100, por la sucursal actual de la persona. Sin horario: los días esperados salen de esos registros.",
  ],
  [
    "Región",
    "La región actual de la sucursal. Las sucursales sin región y las personas sin sucursal van en «Sin región».",
  ],
  [
    "Grupos chicos",
    `Con plantilla promedio menor a ${MIN_GROUP_HEADCOUNT} no se muestra la tasa de rotación; las bajas sí.`,
  ],
];

const TABLE_HEADER = [
  "Nivel",
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
];

const tableRow = (
  level: string,
  region: string,
  site: string,
  row: ReportRow,
): Cell[] => [
  level,
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
];

/** Company total, then each región and its sucursales. */
export const summaryTable = (report: AbsenteeismReport): Cell[][] => [
  TABLE_HEADER,
  tableRow("Empresa", "", "", report.total),
  ...report.regions.flatMap((region) => [
    tableRow("Región", region.label, "", region),
    ...region.sites.map((site) =>
      tableRow("Sucursal", region.label, site.label, site),
    ),
  ]),
];

export const absenteeismSheets = (
  report: AbsenteeismReport,
  context: {
    companyName: string;
    filterText: string;
    generatedAt: string;
    sites: SiteInfo[];
    regions: RegionInfo[];
    detail: { exits: AbsenteeismExitRow[]; people: AbsenteeismPersonRow[] };
  },
): AbsenteeismSheet[] => {
  const siteName = new Map(context.sites.map((site) => [site.id, site.name]));
  const regionName = new Map(
    context.regions.map((region) => [region.id, region.name]),
  );
  const siteLabel = (id: string | null) =>
    id === null ? NO_SITE_LABEL : (siteName.get(id) ?? "(Borrada)");
  const regionLabel = (id: string | null) =>
    id === null ? NO_REGION_LABEL : (regionName.get(id) ?? "(Borrada)");
  const { filter } = report;

  return [
    {
      name: "Resumen",
      rows: [
        ["Ausentismo y rotación por sucursal", context.companyName],
        [
          "Periodo",
          `${formatDateMx(filter.from)} – ${formatDateMx(filter.to)}`,
        ],
        ["Filtros", context.filterText || "Sin filtros"],
        ["Fecha de corte", context.generatedAt],
        [],
        ...summaryTable(report),
        [],
        ["Definición", "Cómo se calcula"],
        ...DEFINITIONS,
      ],
    },
    {
      name: "Bajas",
      rows: [
        [
          "Persona",
          "Fecha de ingreso",
          "Fecha de baja",
          "Clasificación",
          "Región",
          "Sucursal",
        ],
        ...context.detail.exits.map((row) => [
          row.personName,
          formatDateMx(row.fechaIngreso, ""),
          formatDateMx(row.fechaBaja, ""),
          terminationClassificationLabels[row.classification],
          regionLabel(row.regionId),
          siteLabel(row.siteId),
        ]),
      ],
    },
    {
      name: "Ausentismo por persona",
      rows: [
        [
          "Persona",
          "Región",
          "Sucursal",
          "Días con asistencia",
          "Faltas",
          "Faltas justificadas",
          "Ausentismo %",
        ],
        ...context.detail.people.map((row) => [
          row.personName,
          regionLabel(row.regionId),
          siteLabel(row.siteId),
          row.presentDays,
          row.absentDays,
          row.justifiedAbsentDays,
          pct(row.rate),
        ]),
      ],
    },
  ];
};

/**
 * Writes the Excel (every sheet) or the CSV (the table by región and
 * sucursal) to `stream`; returns the number of table rows.
 */
export const writeAbsenteeismExport = async (
  stream: PassThrough,
  format: "xlsx" | "csv",
  report: AbsenteeismReport,
  sheets: AbsenteeismSheet[] | null,
) => {
  const table = summaryTable(report);

  if (format === "csv" || !sheets) {
    stream.write(CSV_BOM);
    for (const row of table) stream.write(csvLine(row.map(String)));
    stream.end();

    return table.length - 1;
  }

  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);

    worksheet.addRows(sheet.rows);
    worksheet.getRow(sheet.name === "Resumen" ? SUMMARY_HEADER_ROW : 1).font = {
      bold: true,
    };
    worksheet.columns.forEach((column) => {
      column.width = 18;
    });
  }

  await workbook.xlsx.write(stream);
  stream.end();

  return table.length - 1;
};

/** «Región: Norte · Sucursal: Centro, Sur» for the file and the audit. */
export const describeAbsenteeismFilter = (
  filter: AbsenteeismReport["filter"],
  sites: SiteInfo[],
  regions: RegionInfo[],
) => {
  const siteName = new Map(sites.map((site) => [site.id, site.name]));
  const regionName = new Map(regions.map((region) => [region.id, region.name]));
  const parts: string[] = [];

  if (filter.regionIds.length > 0) {
    parts.push(
      `Región: ${filter.regionIds.map((id) => regionName.get(id) ?? "(Borrada)").join(", ")}`,
    );
  }

  if (filter.siteIds.length > 0) {
    parts.push(
      `Sucursal: ${filter.siteIds.map((id) => siteName.get(id) ?? "(Borrada)").join(", ")}`,
    );
  }

  return parts.join(" · ");
};
