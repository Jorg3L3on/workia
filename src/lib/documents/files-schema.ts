import { z } from "zod";

import {
  DOCUMENT_REJECTION_REASONS,
  type DocumentRejectionReason,
  type PersonDocumentStatus,
} from "@/lib/db/schema/document-review";
import type { StorageExtension } from "@/lib/storage/keys";

import { isRealIsoDate } from "./schema";

/**
 * Document files and review (W2-04): what an employee may upload, the
 * rejection reasons HR picks from, and the copy both sides share. Pure, so
 * the client components import it too.
 */

/**
 * Vercel caps a function request body at 4.5 MB, so 4 MB leaves room for the
 * form fields. Phone photos are shrunk in the browser first.
 */
export const DOCUMENT_FILE_MAX_BYTES = 4 * 1024 * 1024;

export const DOCUMENT_FILE_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<string, StorageExtension>;

export type DocumentFileType = keyof typeof DOCUMENT_FILE_TYPES;

/** The input's accept: camera and gallery on a phone, plus PDF files. */
export const DOCUMENT_FILE_ACCEPT = "image/*,application/pdf";

/**
 * The file's real type from its first bytes, never from the name or the
 * browser's claim. Anything else (HEIC that the browser did not convert,
 * Word, an executable) is null.
 */
export const sniffDocumentFileType = (
  bytes: Uint8Array,
): DocumentFileType | null => {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
};

export const documentRejectionReasonLabels: Record<
  DocumentRejectionReason,
  string
> = {
  illegible: "No se lee bien",
  wrong_document: "No es el documento que se pide",
  expired: "Está vencido",
  incomplete: "Está incompleto (falta una hoja o un lado)",
  wrong_person: "Es de otra persona",
};

export const personDocumentStatusLabels: Record<PersonDocumentStatus, string> =
  {
    uploaded: "En revisión",
    accepted: "Aceptado",
    rejected: "Rechazado",
  };

export const DOCUMENT_FILES_COPY = {
  tooLarge:
    "El archivo pesa más de 4 MB. Toma la foto de nuevo o usa un PDF más ligero.",
  badType: "Sube una foto (JPG, PNG o WebP) o un PDF.",
  empty: "Elige un archivo.",
  pending: "Ya enviaste este documento. RH lo está revisando.",
  notRequired: "Ese documento no se pide para tu puesto.",
  noStorage:
    "Todavía no se pueden subir archivos: RH aún no configura dónde guardarlos.",
  noNotice:
    "Tu empresa aún no publica su aviso de privacidad, así que todavía no puedes subir documentos.",
  noticePending:
    "Antes de subir documentos, lee y acepta el aviso de privacidad.",
  uploadFailed: "No se pudo subir el archivo. Intenta de nuevo.",
  uploaded: "Listo. RH revisará tu documento.",
  reviewEmpty: "No hay documentos por revisar.",
  notFound: "Ese documento ya no está pendiente de revisión.",
} as const;

export const reviewDocumentSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accept"),
      documentId: z.string().uuid(),
      /** Omitted: from validity_months, as recordDelivery does. Null: no expiry. */
      expiresOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha día/mes/año.")
        .refine(isRealIsoDate, "La fecha de vencimiento no existe.")
        .nullable()
        .optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      documentId: z.string().uuid(),
      reason: z.enum(DOCUMENT_REJECTION_REASONS, {
        error: "Elige el motivo del rechazo.",
      }),
    })
    .strict(),
]);

export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;
