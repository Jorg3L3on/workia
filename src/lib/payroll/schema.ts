import { z } from "zod";

import type { PayrollMatchKind } from "@/lib/db/schema/payroll";

/** Shared by the import dialog, the upload route and the period actions (W2-03). */

/** One request carries one receipt, so it stays under the 4.5 MB a function accepts. */
export const RECEIPT_PDF_MAX_BYTES = 3 * 1024 * 1024;

/** How many receipts the browser uploads at once. */
export const RECEIPT_UPLOAD_CONCURRENCY = 4;

/** A zip larger than this is not one period of receipts. */
export const RECEIPT_ZIP_MAX_BYTES = 400 * 1024 * 1024;

/** How long a download link the app hands out stays valid. */
export const RECEIPT_URL_SECONDS = 120;

export const PAYROLL_COPY = {
  title: "Recibos de nómina",
  description:
    "Importa los CFDI de cada periodo, revisa los que no se asignaron y publícalos para que cada persona los descargue desde su teléfono.",
  denied: "No tienes permiso para administrar los recibos de nómina.",
  storageMissing:
    "Falta configurar el almacenamiento de archivos (S3_*). Hasta entonces no se pueden importar recibos.",
  periodNotFound: "El periodo no existe en esta empresa.",
  periodLabel: "Escribe el nombre del periodo, por ejemplo «2026-10 Q2».",
  periodLabelTaken: "Ya existe un periodo con ese nombre.",
  periodDates: "La fecha final no puede ser antes de la inicial.",
  periodCreated: "Periodo creado.",
  periodPublished: "Periodo publicado. Las personas ya pueden ver su recibo.",
  periodAlreadyPublished: "El periodo ya está publicado.",
  periodDiscarded: "Importación descartada.",
  periodNotDraft: "Solo se puede descartar un periodo sin publicar.",
  receiptNotFound: "El recibo no existe en esta empresa.",
  receiptAlreadyMatched: "Ese recibo ya tiene persona.",
  receiptAssigned: "Recibo asignado.",
  person: "Elige a la persona.",
  personNotFound: "La persona no existe en esta empresa.",
  xmlMissing: "Falta el XML del CFDI.",
  xmlTooLarge: "El XML es demasiado grande para un recibo de nómina.",
  pdfTooLarge: "El PDF pesa más de 3 MB.",
  pdfInvalid: "El archivo no es un PDF.",
  duplicate: "Ese CFDI ya estaba importado.",
};

export const matchKindLabels: Record<PayrollMatchKind, string> = {
  curp: "CURP",
  num_empleado: "Número de empleado",
  rfc: "RFC",
  manual: "Asignado por RH",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

export const createPeriodSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, PAYROLL_COPY.periodLabel)
      .max(80, PAYROLL_COPY.periodLabel),
    periodStart: isoDate,
    periodEnd: isoDate,
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: PAYROLL_COPY.periodDates,
    path: ["periodEnd"],
  });

export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

export const assignReceiptSchema = z.object({
  receiptId: z.string().uuid(PAYROLL_COPY.receiptNotFound),
  personId: z.string().uuid(PAYROLL_COPY.person),
});

export type PayrollActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  periodId?: string;
};

/** The label a period gets by default: year, month and quincena of its end. */
export const suggestedPeriodLabel = (periodEnd: string) => {
  const [year, month, day] = periodEnd.split("-");

  return `${year}-${month} Q${Number(day) <= 15 ? 1 : 2}`;
};

/** Share of delivered receipts the employees opened, 0–100, rounded down. */
export const openedPercent = (opened: number, delivered: number) =>
  delivered > 0 ? Math.floor((opened * 100) / delivered) : 0;

/** Starts with %PDF-, as every PDF does. */
export const looksLikePdf = (bytes: Uint8Array) =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;
