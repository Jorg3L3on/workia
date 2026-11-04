import { formatDateMx } from "@/lib/format/date";

/**
 * The words of the LFT alerts (W2-19). The legal threshold is stated once,
 * here, so the inbox, the email, the push and the log say the same thing.
 *
 * LFT article 47, section X: the employer may rescind the work relationship,
 * without liability, when the worker has "más de tres faltas de asistencia en
 * un período de treinta días, sin permiso del patrón o sin causa
 * justificada". So three faltas is the warning and the fourth is the
 * threshold. Workia only warns: deciding or drafting a rescission is out of
 * scope.
 */
export const LFT_ABSENCE_RULE =
  "La Ley Federal del Trabajo (artículo 47, fracción X) permite rescindir la relación de trabajo sin responsabilidad para el patrón cuando la persona tiene más de tres faltas de asistencia en un periodo de 30 días, sin permiso del patrón o sin causa justificada.";

type AbsenceCopyInput = { count: number; from: string; to: string };

const range = ({ from, to }: AbsenceCopyInput) =>
  `del ${formatDateMx(from)} al ${formatDateMx(to)}`;

/** The body of an absence alert, in every channel. */
export const absenceAlertBody = (
  kind: "absence_warning" | "absence_threshold",
  data: AbsenceCopyInput,
) =>
  kind === "absence_warning"
    ? [
        `Tiene ${data.count} faltas sin justificar ${range(data)}.`,
        LFT_ABSENCE_RULE,
        "Con una falta más sin justificar en esos 30 días se rebasa ese límite.",
        "Revisa si alguna tiene un permiso, una incapacidad o una checada pendiente de cargar.",
      ].join(" ")
    : [
        `Tiene ${data.count} faltas sin justificar ${range(data)}: más de tres en 30 días.`,
        LFT_ABSENCE_RULE,
        "Workia solo avisa; no decide ni redacta una rescisión. Revisa el caso y sus justificaciones con tu área legal antes de actuar.",
      ].join(" ");

export const LFT_ALERT_KIND_LABEL = {
  absence_warning: "Faltas: aviso preventivo",
  absence_threshold: "Faltas: más de tres en 30 días",
  contract_ending: "Contrato por terminar",
  document_expiring: "Documento por vencer",
} as const;

export const LFT_ALERTS_COPY = {
  title: "Alertas LFT",
  description:
    "Lo que Workia avisó a RH y a los jefes: faltas que se acercan al límite de la LFT, contratos que terminan en 30 días y documentos que vencen.",
  emptyTitle: "Sin alertas",
  emptyDescription:
    "Cuando alguien llegue a tres faltas sin justificar en 30 días, o un contrato o documento esté por vencer, aparecerá aquí.",
  runNow: "Revisar ahora",
  running: "Revisando…",
  ran: (sent: number) =>
    sent === 0
      ? "Revisión hecha. No hay alertas nuevas."
      : sent === 1
        ? "Revisión hecha. Se envió 1 alerta nueva."
        : `Revisión hecha. Se enviaron ${sent} alertas nuevas.`,
  failed: "No se pudo hacer la revisión. Intenta de nuevo.",
  forbidden: "No tienes permiso para revisar alertas en esta empresa.",
  recipients: (hr: number, manager: boolean) =>
    [
      hr === 1 ? "1 persona de RH" : `${hr} personas de RH`,
      manager ? "su jefe" : "sin jefe asignado",
    ].join(" · "),
  rule: LFT_ABSENCE_RULE,
  older: "Anteriores",
  newest: "Más recientes",
} as const;
