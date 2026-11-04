import { z } from "zod";

import {
  ARCO_KINDS,
  type ArcoKind,
  type ArcoStatus,
  type PersonalDataResource,
} from "@/lib/db/schema/privacy";

/**
 * Privacy, retention and ARCO (Workia 2.0, W2-09), under the LFPDPPP in
 * force (the 2025 law). Each line marked «pendiente de revisión legal» is a
 * choice the legal review of the notice must confirm; the product uses the
 * stricter simple default until then.
 *
 * pendiente de revisión legal: an ARCO request is answered within 20
 * calendar days of receipt. Counting calendar days is never later than
 * counting working days, so the date HR sees is the safe one.
 */
export const ARCO_RESPONSE_DAYS = 20;

export const PRIVACY_NOTICE_MAX_LENGTH = 50_000;
export const ARCO_DETAIL_MAX_LENGTH = 2_000;
export const ARCO_RESPONSE_MAX_LENGTH = 4_000;

export const PRIVACY_COPY = {
  title: "Privacidad",
  description:
    "Aviso de privacidad, solicitudes ARCO, conservación de datos y registro de accesos.",
  noticeTitle: "Aviso de privacidad",
  noticeEmpty:
    "Aún no hay aviso publicado. Las personas lo aceptarán al entrar por primera vez a la app.",
  noticeBody: "Escribe el texto completo del aviso.",
  noticeTooLong: `El aviso puede tener hasta ${PRIVACY_NOTICE_MAX_LENGTH.toLocaleString("es-MX")} caracteres.`,
  noticeSame: "El texto es igual a la versión vigente.",
  noticePublished: "Aviso publicado.",
  noticeRace:
    "Otra persona publicó una versión al mismo tiempo. Recarga la página.",
  noNotice: "Publica un aviso de privacidad antes de registrar aceptaciones.",
  noticeNotCurrent: "Esa versión del aviso ya no es la vigente.",
  acceptanceRecorded: "Aceptación registrada.",
  arcoTitle: "Solicitudes ARCO",
  arcoEmpty: "Sin solicitudes ARCO.",
  arcoDetail: "Describe lo que pide la persona.",
  arcoDetailTooLong: `La descripción puede tener hasta ${ARCO_DETAIL_MAX_LENGTH.toLocaleString("es-MX")} caracteres.`,
  arcoResponse: "Escribe la respuesta que se le dio a la persona.",
  arcoResponseTooLong: `La respuesta puede tener hasta ${ARCO_RESPONSE_MAX_LENGTH.toLocaleString("es-MX")} caracteres.`,
  arcoKind: "Elige el tipo de solicitud.",
  arcoReceivedOn: "Indica la fecha en que se recibió.",
  arcoFutureDate: "La fecha de recepción no puede ser futura.",
  arcoCreated: "Solicitud registrada.",
  arcoResolved: "Solicitud cerrada.",
  arcoAlreadyClosed: "Esa solicitud ya está cerrada.",
  arcoNotFound: "No encontramos esa solicitud en esta empresa.",
  personNotFound: "No encontramos a esa persona en esta empresa.",
  person: "Elige a la persona.",
  retentionTitle: "Conservación de datos",
  accessTitle: "Registro de accesos",
  accessEmpty: "Nadie ha abierto documentos ni recibos todavía.",
  denied: "No tienes permiso para gestionar la privacidad.",
} as const;

export const arcoKindLabels: Record<ArcoKind, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  cancellation: "Cancelación",
  opposition: "Oposición",
};

export const arcoStatusLabels: Record<ArcoStatus, string> = {
  received: "Pendiente",
  resolved: "Atendida",
  rejected: "Improcedente",
};

export const personalDataResourceLabels: Record<PersonalDataResource, string> =
  {
    contract_pdf: "PDF del contrato",
    document_file: "Archivo de documento",
    payroll_receipt: "Recibo de nómina",
    vacation_constancia: "Constancia de vacaciones",
    arco_export: "Exportación ARCO",
    seniority_letter: "Constancia de antigüedad",
  };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRealIsoDate = (value: string) => {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
};

/** receivedOn plus ARCO_RESPONSE_DAYS calendar days, as YYYY-MM-DD. */
export const arcoDueOn = (receivedOn: string) => {
  if (!isRealIsoDate(receivedOn)) {
    throw new Error("Fecha ISO inválida.");
  }

  const [year, month, day] = receivedOn.split("-").map(Number);
  const due = new Date(Date.UTC(year, month - 1, day + ARCO_RESPONSE_DAYS));

  return due.toISOString().slice(0, 10);
};

/** Days from today to dueOn: negative when it is late. Both YYYY-MM-DD. */
export const arcoDaysLeft = (dueOn: string, today: string) => {
  const toUtc = (iso: string) => {
    const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.round((toUtc(dueOn) - toUtc(today)) / 86_400_000);
};

/** Line endings folded so a pasted copy of the same notice is the same text. */
export const normalizeNoticeBody = (body: string) =>
  body.replace(/\r\n?/g, "\n").trim();

export const publishNoticeSchema = z
  .object({
    body: z
      .string()
      .transform(normalizeNoticeBody)
      .pipe(
        z
          .string()
          .min(1, PRIVACY_COPY.noticeBody)
          .max(PRIVACY_NOTICE_MAX_LENGTH, PRIVACY_COPY.noticeTooLong),
      ),
  })
  .strict();

export type PublishNoticeInput = z.infer<typeof publishNoticeSchema>;

export const recordAcceptanceSchema = z
  .object({
    personId: z.string().uuid(PRIVACY_COPY.person),
    noticeId: z.string().uuid(PRIVACY_COPY.noticeNotCurrent),
    channel: z.enum(["employee_app", "hr"]),
  })
  .strict();

export type RecordAcceptanceInput = z.infer<typeof recordAcceptanceSchema>;

export const createArcoRequestSchema = z
  .object({
    personId: z.string().uuid(PRIVACY_COPY.person),
    kind: z.enum(ARCO_KINDS, { message: PRIVACY_COPY.arcoKind }),
    channel: z.enum(["employee_app", "hr"]),
    detail: z
      .string()
      .trim()
      .min(1, PRIVACY_COPY.arcoDetail)
      .max(ARCO_DETAIL_MAX_LENGTH, PRIVACY_COPY.arcoDetailTooLong),
    receivedOn: z.string().refine(isRealIsoDate, PRIVACY_COPY.arcoReceivedOn),
  })
  .strict();

export type CreateArcoRequestInput = z.infer<typeof createArcoRequestSchema>;

export const resolveArcoRequestSchema = z
  .object({
    requestId: z.string().uuid(PRIVACY_COPY.arcoNotFound),
    outcome: z.enum(["resolved", "rejected"]),
    response: z
      .string()
      .trim()
      .min(1, PRIVACY_COPY.arcoResponse)
      .max(ARCO_RESPONSE_MAX_LENGTH, PRIVACY_COPY.arcoResponseTooLong),
  })
  .strict();

export type ResolveArcoRequestInput = z.infer<typeof resolveArcoRequestSchema>;

export type PrivacyActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
};
