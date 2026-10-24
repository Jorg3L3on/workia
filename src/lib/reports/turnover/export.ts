import type { PassThrough } from "node:stream";

import ExcelJS from "exceljs";

import { formatDateMx } from "@/lib/format/date";
import { CSV_BOM, csvLine } from "@/lib/import/export-rows";
import { terminationTypeLabels } from "@/lib/people/employment-schema";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";

import { monthsBetween } from "./dates";
import type { TurnoverFiniquito } from "./data";
import type { TurnoverLabels } from "./labels";
import { TRIAL_DAYS } from "./metrics";
import type {
  LabeledBreakdownRow,
  TurnoverDetailRow,
  TurnoverReport,
} from "./report";

export type { TurnoverFiniquito } from "./data";

const pct = (value: number | null) =>
  value === null ? "" : Math.round(value * 10) / 10;

const yesNo = (value: boolean | null) =>
  value === null ? "" : value ? "Sí" : "No";

type Cell = string | number;

export type TurnoverSheet = { name: string; rows: Cell[][] };

const DEFINITIONS: [string, string][] = [
  [
    "Baja",
    "Un periodo laboral con fecha de baja en el rango. Las bajas «sin fecha» no cuentan. Un reingreso que vuelve a salir son 2 bajas.",
  ],
  [
    "Plantilla del mes",
    "(activos el día 1 + activos al cierre del último día) / 2. Quien sale el último día no está en la plantilla final.",
  ],
  [
    "Plantilla de varios meses",
    "Promedio de las plantillas mensuales; un rango que no son meses completos usa (inicio + fin) / 2 del rango.",
  ],
  [
    "Rotación",
    "Bajas / plantilla promedio × 100. Nunca suma ni promedio de tasas mensuales.",
  ],
  [
    "Voluntaria / involuntaria / otra",
    "Según la clasificación actual del motivo; sin motivo, según el tipo de baja. Un motivo sin clasificar cuenta como otra.",
  ],
  [
    "Salida en prueba",
    `Baja en o antes del día ${TRIAL_DAYS} de su periodo (el ingreso es el día 1).`,
  ],
  [
    "Retención 30/60/90",
    "De los ingresos de un mes, % activo el día de ingreso + 30, 60 y 90.",
  ],
  [
    "Grupos chicos",
    "Área, sucursal o jefe con plantilla menor a 5 se juntan en «Otros» y no muestran tasa propia.",
  ],
];

const breakdownSheet = (name: string, rows: LabeledBreakdownRow[]) => ({
  name,
  rows: [
    ["Grupo", "Bajas", "Plantilla promedio", "Rotación %"],
    ...rows.map((row) => [row.label, row.exits, row.headcount, pct(row.rate)]),
  ],
});

/** The detail sheet: one baja of the range per row. */
export const exitRows = (
  exits: TurnoverDetailRow[],
  labels: TurnoverLabels,
  finiquitos: Map<string, TurnoverFiniquito> | null,
): Cell[][] => [
  [
    "Persona",
    "Fecha de ingreso",
    "Fecha de baja",
    "Días en el periodo",
    "Salida en prueba",
    "Tipo de baja",
    "Motivo",
    "Clasificación",
    "Recontratable",
    "Área",
    "Sucursal",
    "Puesto",
    "Jefe",
    "Reingresó después",
    ...(finiquitos
      ? ["Finiquito", "Fecha del finiquito", "Monto del finiquito"]
      : []),
  ],
  ...exits.map((row) => {
    const finiquito = finiquitos?.get(row.id);

    return [
      row.personName,
      formatDateMx(row.fechaIngreso, ""),
      formatDateMx(row.fechaBaja, ""),
      row.days ?? "",
      row.days === null ? "" : row.days <= TRIAL_DAYS ? "Sí" : "No",
      row.tipoBaja ? terminationTypeLabels[row.tipoBaja] : "",
      row.motivo ?? "Sin motivo",
      row.classification
        ? terminationClassificationLabels[row.classification]
        : "",
      yesNo(row.recontratable),
      row.areaId ? (labels.areas[row.areaId] ?? "") : "",
      row.siteId ? (labels.sites[row.siteId] ?? "") : "",
      row.positionId ? (labels.positions[row.positionId] ?? "") : "",
      row.managerId ? (labels.managers[row.managerId] ?? "") : "",
      yesNo(row.hasLaterPeriod),
      ...(finiquitos
        ? [
            finiquito?.estado ?? "",
            formatDateMx(finiquito?.fecha, ""),
            finiquito?.monto ?? "",
          ]
        : []),
    ];
  }),
];

/**
 * Every sheet of the Excel file, from the same report the dashboard shows:
 * Resumen (with the definitions), Mensual, Por área, Por sucursal, Por jefe,
 * Por motivo, Cohortes and Bajas.
 */
export const turnoverSheets = (
  report: TurnoverReport,
  labels: TurnoverLabels,
  context: {
    companyName: string;
    filterText: string;
    generatedAt: string;
    finiquitos: TurnoverFiniquito[] | null;
  },
): TurnoverSheet[] => {
  const { summary, filter } = report;
  const exits = (report.detail?.exits ?? []).filter(
    (row) =>
      row.fechaBaja !== null &&
      row.fechaBaja >= filter.from &&
      row.fechaBaja <= filter.to,
  );
  const finiquitos = context.finiquitos
    ? new Map(context.finiquitos.map((item) => [item.periodId, item]))
    : null;
  const finiquitoPaid = context.finiquitos
    ?.filter(
      (item) =>
        item.estado === "pagado" &&
        item.fecha !== null &&
        item.fecha >= filter.from &&
        item.fecha <= filter.to,
    )
    .reduce((sum, item) => sum + (item.monto ?? 0), 0);
  const rangeMonths = new Set(monthsBetween(filter.from, filter.to));

  return [
    {
      name: "Resumen",
      rows: [
        ["Reporte de rotación", context.companyName],
        [
          "Periodo",
          `${formatDateMx(filter.from)} – ${formatDateMx(filter.to)}`,
        ],
        ["Filtros", context.filterText || "Sin filtros"],
        ["Fecha de corte", context.generatedAt],
        [],
        ["Indicador", "Valor"],
        ["Rotación %", pct(summary.rate)],
        ["Bajas", summary.exits],
        ["Plantilla promedio", summary.headcount],
        ["Voluntaria %", pct(summary.byClass.voluntaria.rate)],
        ["Involuntaria %", pct(summary.byClass.involuntaria.rate)],
        ["Otra %", pct(summary.byClass.otra.rate)],
        ["Bajas en prueba (≤ 90 días)", summary.trial.exits],
        ["Bajas en prueba %", pct(summary.trial.share)],
        ["Ingresos", summary.hires],
        ["Reingresos", summary.reentries.count],
        ["Rotación 12 meses %", pct(report.rolling.rate)],
        ["Rotación 12 meses estimada", report.rolling.estimated ? "Sí" : "No"],
        ["Meta mensual %", report.goal.monthly ?? ""],
        ["Meta del periodo %", report.goal.forRange ?? ""],
        ["Rotación periodo anterior %", pct(report.previous.rate)],
        ["Rotación un año antes %", pct(report.lastYear?.rate ?? null)],
        ...(finiquitoPaid === undefined
          ? []
          : [["Finiquito pagado en el periodo", finiquitoPaid]]),
        [],
        ["Definición", "Cómo se calcula"],
        ...DEFINITIONS,
      ],
    },
    {
      name: "Mensual",
      rows: [
        [
          "Mes",
          "En el periodo",
          "Activos día 1",
          "Activos al cierre",
          "Plantilla",
          "Promedio diario",
          "Bajas",
          "Voluntarias",
          "Involuntarias",
          "Otras",
          "Rotación %",
        ],
        ...report.trend.map((point) => [
          point.month,
          rangeMonths.has(point.month) ? "Sí" : "No",
          point.start,
          point.end,
          point.average,
          point.dailyAverage,
          point.exits,
          point.byClass.voluntaria,
          point.byClass.involuntaria,
          point.byClass.otra,
          pct(point.rate),
        ]),
      ],
    },
    breakdownSheet("Por área", report.breakdowns.area),
    breakdownSheet("Por sucursal", report.breakdowns.site),
    breakdownSheet("Por jefe", report.breakdowns.manager),
    {
      name: "Por motivo",
      rows: [
        ["Motivo", "Clasificación", "Bajas", "% de las bajas"],
        ...report.reasons.map((reason) => [
          reason.name ?? "Sin motivo",
          terminationClassificationLabels[reason.classification],
          reason.exits,
          pct(reason.share),
        ]),
      ],
    },
    {
      name: "Cohortes",
      rows: [
        [
          "Mes de ingreso",
          "Ingresos",
          "Día 30",
          "Día 30 %",
          "Día 60",
          "Día 60 %",
          "Día 90",
          "Día 90 %",
        ],
        ...report.cohorts.map((row) => [
          row.month,
          row.hires,
          ...row.cells.flatMap((cell) =>
            cell.mature ? [cell.retained, pct(cell.rate)] : ["en curso", ""],
          ),
        ]),
      ],
    },
    { name: "Bajas", rows: exitRows(exits, labels, finiquitos) },
  ];
};

/** Writes the Excel (every sheet) or the CSV (the Bajas sheet) to `stream`. */
export const writeTurnoverExport = async (
  stream: PassThrough,
  format: "xlsx" | "csv",
  sheets: TurnoverSheet[],
) => {
  if (format === "csv") {
    const detail = sheets.find((sheet) => sheet.name === "Bajas")!;

    stream.write(CSV_BOM);
    for (const row of detail.rows) stream.write(csvLine(row.map(String)));
    stream.end();

    return detail.rows.length - 1;
  }

  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);

    worksheet.addRows(sheet.rows);
    worksheet.getRow(sheet.name === "Resumen" ? 6 : 1).font = { bold: true };
    worksheet.columns.forEach((column) => {
      column.width = 18;
    });
  }

  await workbook.xlsx.write(stream);
  stream.end();

  return (sheets.find((sheet) => sheet.name === "Bajas")?.rows.length ?? 1) - 1;
};
