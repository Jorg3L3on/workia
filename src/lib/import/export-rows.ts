import { IMPORT_COLUMNS, type ImportSheetKey } from "./format";

/** Pure row building for the export, so the file matches the import format. */

const statusLabel = { activa: "Activa", baja: "Baja" } as const;
const typeLabel = {
  determinado: "Determinado",
  indeterminado: "Indeterminado",
} as const;
const noticeLabel = {
  "1": "1",
  "2": "2",
  "3": "3",
  "6": "6",
  no_avisar: "No avisar",
} as const;
const contractStatusLabel = {
  vigente: "Vigente",
  renovado: "Renovado",
  no_renovado: "No renovado",
  vencido: "Vencido",
  terminado: "Terminado",
} as const;

/** `2024-03-05` -> `05/03/2024`; anything else passes through. */
export const formatExportDate = (value: string | null | undefined) => {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ?? "");
};

export type ExportPerson = {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  email: string | null;
  telefono: string | null;
  fechaNacimiento: string | null;
  fechaIngreso: string | null;
  areaName: string | null;
  positionName: string | null;
  siteName: string | null;
  managerId: string | null;
  managerCurp: string | null;
  rfc: string | null;
  curp: string | null;
  nss: string | null;
  status: "activa" | "baja";
};

export type ExportSchedule = {
  personId: string;
  entrada: string | null;
  salidaComer: string | null;
  regresoComer: string | null;
  salida: string | null;
};

export type ExportContract = {
  personId: string;
  type: keyof typeof typeLabel;
  startDate: string;
  endDate: string | null;
  noticeWindow: keyof typeof noticeLabel;
  status: keyof typeof contractStatusLabel;
  templateName: string | null;
};

export type ExportRow = Record<string, string>;

export const personExportRow = (person: ExportPerson): ExportRow => ({
  idWorkia: person.id,
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  apellidoMaterno: person.apellidoMaterno ?? "",
  email: person.email ?? "",
  telefono: person.telefono ?? "",
  fechaNacimiento: formatExportDate(person.fechaNacimiento),
  fechaIngreso: formatExportDate(person.fechaIngreso),
  area: person.areaName ?? "",
  puesto: person.positionName ?? "",
  sucursal: person.siteName ?? "",
  // CURP when the manager has one (readable), else the ID Workia.
  jefeDirecto: person.managerCurp ?? person.managerId ?? "",
  rfc: person.rfc ?? "",
  curp: person.curp ?? "",
  nss: person.nss ?? "",
  estatus: statusLabel[person.status],
});

export const scheduleExportRow = (
  schedule: ExportSchedule,
  person: Pick<ExportPerson, "id" | "curp">,
): ExportRow => ({
  idWorkia: person.id,
  curp: person.curp ?? "",
  entrada: schedule.entrada ?? "",
  salidaComer: schedule.salidaComer ?? "",
  regresoComer: schedule.regresoComer ?? "",
  salida: schedule.salida ?? "",
});

export const contractExportRow = (
  contract: ExportContract,
  person: Pick<ExportPerson, "id" | "curp">,
): ExportRow => ({
  idWorkia: person.id,
  curp: person.curp ?? "",
  tipo: typeLabel[contract.type],
  fechaInicio: formatExportDate(contract.startDate),
  fechaFin: formatExportDate(contract.endDate),
  aviso: noticeLabel[contract.noticeWindow],
  estatus: contractStatusLabel[contract.status],
  plantilla: contract.templateName ?? "",
});

export const exportHeaders = (sheet: ImportSheetKey) =>
  IMPORT_COLUMNS[sheet].map((column) => column.label);

export const orderedValues = (sheet: ImportSheetKey, row: ExportRow) =>
  IMPORT_COLUMNS[sheet].map((column) => row[column.key] ?? "");

const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const csvLine = (values: readonly string[]) =>
  `${values.map(csvCell).join(",")}\r\n`;

export const CSV_BOM = "﻿";
