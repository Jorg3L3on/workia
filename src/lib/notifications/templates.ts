import type { NotificationTemplate } from "@/lib/db/schema/notifications";
import { formatDateMx } from "@/lib/format/date";
import { absenceAlertBody } from "@/lib/lft-alerts/copy";

/**
 * The five messages of W2-08, in plain Spanish. Each template turns its data
 * into a title, a body and the app path it opens; email and push reuse the
 * same words, so a message reads the same in every channel. Rendered when the
 * notification is created and stored, so the inbox never changes later.
 */
export type RecipientKind = "person" | "user";

export type RequestKind = "vacaciones" | "permiso";

export type TemplateData = {
  /** A nómina receipt of a period is ready for the employee (W2-03). */
  receipt_available: { period: string };
  /** A manager or HR decided the employee's request (W2-05, W2-06). */
  request_decision: {
    request: RequestKind;
    decision: "aprobada" | "rechazada";
    from: string;
    to: string;
    reason?: string | null;
  };
  /** HR rejected a document the employee uploaded (W2-04). */
  document_rejected: { document: string; reason: string };
  /** A contract of the recipient's team or company ends soon (W2-19). */
  contract_ending: { personId: string; personName: string; endDate: string };
  /** A request waits for the recipient's decision (W2-06). */
  request_pending: {
    requesterName: string;
    request: RequestKind;
    from: string;
    to: string;
  };
  /** Three unjustified faltas in 30 days: one more is the LFT threshold (W2-19). */
  absence_warning: AbsenceAlertData;
  /** More than three unjustified faltas in 30 days (LFT art. 47-X, W2-19). */
  absence_threshold: AbsenceAlertData;
  /** A document of the recipient's team or company expires soon (W2-19). */
  document_expiring: {
    personId: string;
    personName: string;
    document: string;
    expiresOn: string;
  };
};

/** The faltas an absence alert counts: how many, and the 30 days they fall in. */
export type AbsenceAlertData = {
  personId: string;
  personName: string;
  count: number;
  from: string;
  to: string;
};

export type NotificationContent = {
  title: string;
  body: string;
  url: string;
};

const REQUEST_LABEL: Record<RequestKind, string> = {
  vacaciones: "vacaciones",
  permiso: "permiso",
};

const dateRange = (from: string, to: string) =>
  from === to
    ? `el ${formatDateMx(from)}`
    : `del ${formatDateMx(from)} al ${formatDateMx(to)}`;

/** Where each audience reads its messages. */
export const INBOX_PATH: Record<RecipientKind, string> = {
  person: "/mi/avisos",
  user: "/app/avisos",
};

type Renderers = {
  [T in NotificationTemplate]: (
    data: TemplateData[T],
    recipient: RecipientKind,
  ) => NotificationContent;
};

const RENDERERS: Renderers = {
  receipt_available: ({ period }) => ({
    title: "Tu recibo de nómina está listo",
    body: `Ya puedes ver y descargar tu recibo de ${period}.`,
    url: "/mi",
  }),
  request_decision: ({ request, decision, from, to, reason }) => ({
    title:
      decision === "aprobada"
        ? `Aprobaron tu solicitud de ${REQUEST_LABEL[request]}`
        : `Rechazaron tu solicitud de ${REQUEST_LABEL[request]}`,
    body: [
      `Tu solicitud de ${REQUEST_LABEL[request]} ${dateRange(from, to)} fue ${decision}.`,
      reason ? `Motivo: ${reason}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    url: "/mi",
  }),
  document_rejected: ({ document, reason }) => ({
    title: `RH rechazó tu documento: ${document}`,
    body: `Motivo: ${reason} Sube una versión nueva desde la app.`,
    url: "/mi",
  }),
  contract_ending: ({ personId, personName, endDate }, recipient) => ({
    title: `El contrato de ${personName} termina pronto`,
    body: `Su contrato vence el ${formatDateMx(endDate)}. Decide si se renueva antes de esa fecha.`,
    url: recipient === "user" ? `/app/personas/${personId}` : "/mi",
  }),
  request_pending: ({ requesterName, request, from, to }) => ({
    title: `${requesterName} pide ${REQUEST_LABEL[request]}`,
    body: `Solicitud de ${REQUEST_LABEL[request]} ${dateRange(from, to)}. Espera tu decisión.`,
    url: "/mi",
  }),
  absence_warning: (data, recipient) => ({
    title: `${data.personName} tiene ${data.count} faltas sin justificar en 30 días`,
    body: absenceAlertBody("absence_warning", data),
    url: recipient === "user" ? `/app/personas/${data.personId}` : "/mi",
  }),
  absence_threshold: (data, recipient) => ({
    title: `${data.personName} tiene más de tres faltas sin justificar en 30 días`,
    body: absenceAlertBody("absence_threshold", data),
    url: recipient === "user" ? `/app/personas/${data.personId}` : "/mi",
  }),
  document_expiring: (
    { personId, personName, document, expiresOn },
    recipient,
  ) => ({
    title: `Vence un documento de ${personName}`,
    body: `${document} vence el ${formatDateMx(expiresOn)}. Pide la versión vigente antes de esa fecha.`,
    url: recipient === "user" ? `/app/personas/${personId}` : "/mi",
  }),
};

export const renderNotification = <T extends NotificationTemplate>(
  template: T,
  data: TemplateData[T],
  recipient: RecipientKind,
): NotificationContent =>
  (
    RENDERERS[template] as (
      data: TemplateData[T],
      recipient: RecipientKind,
    ) => NotificationContent
  )(data, recipient);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The email of a notification: its words, a link to open it, and how to stop the emails. */
export const notificationEmail = (
  content: Pick<NotificationContent, "title" | "body" | "url">,
  origin: string,
  recipient: RecipientKind,
) => {
  const link = new URL(content.url, origin).toString();
  const settings = new URL(INBOX_PATH[recipient], origin).toString();
  const lines = [
    content.body,
    `Ábrelo en Workia: ${link}`,
    `Para dejar de recibir estos correos, entra a ${settings}. Los avisos seguirán en la app.`,
  ];

  return {
    subject: content.title,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  };
};
