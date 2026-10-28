import { latestDelivery, statusOf, type DocumentStatus } from "./schema";

/**
 * The «Documentos por vencer» tray (WRK-I15-4). One row per person and
 * requirement: the latest delivery, and only when that delivery expires.
 * `today` is the company calendar date (`isoToday()`).
 */

export const EXPIRING_DOCUMENT_STATUSES = ["expiring", "expired"] as const;

export type ExpiringDocumentStatus =
  (typeof EXPIRING_DOCUMENT_STATUSES)[number];

/** URL value of the tray's Estado filter. Missing means por vencer. */
export const EXPIRING_STATUS_PARAMS = {
  expiring: "por-vencer",
  expired: "vencido",
} as const satisfies Record<ExpiringDocumentStatus, string>;

export const EXPIRING_DOCUMENTS_COPY = {
  title: "Documentos por vencer",
  description: "Entregas que vencen en los próximos 30 días.",
  expiredDescription: "Entregas cuya vigencia ya pasó.",
  emptyTitle: "Sin documentos por vencer",
  emptyDescription: "Nada vence en los próximos 30 días.",
  emptyExpiredTitle: "Sin documentos vencidos",
  emptyExpiredDescription: "No hay entregas con la vigencia vencida.",
  error: "No se pudieron cargar los documentos por vencer.",
  loading: "Cargando documentos por vencer",
  noPosition: "Sin puesto",
  searchPlaceholder: "Buscar persona, puesto o documento",
} as const;

export type ExpiringDocumentCandidate = {
  id: string;
  personId: string;
  requirementId: string;
  deliveredOn: string;
  expiresOn: string | null;
  createdAt?: Date | string | null;
  personName: string;
  positionId: string | null;
  positionName: string | null;
  requirementName: string;
};

export type ExpiringDocumentRow = {
  id: string;
  personId: string;
  personName: string;
  positionId: string | null;
  positionName: string | null;
  requirementId: string;
  requirementName: string;
  deliveredOn: string;
  expiresOn: string;
  status: ExpiringDocumentStatus;
};

export type ExpiringDocumentQuery = {
  positionId?: string;
  status?: ExpiringDocumentStatus;
};

/** `vencido` is the only status besides the 30-day window. */
export const expiringStatusFromParam = (
  value: string | undefined,
): ExpiringDocumentStatus =>
  value === EXPIRING_STATUS_PARAMS.expired ? "expired" : "expiring";

const isWindowStatus = (
  status: DocumentStatus,
): status is ExpiringDocumentStatus =>
  status === "expiring" || status === "expired";

/**
 * Latest delivery of each person and requirement, kept when its status is
 * the one asked for (por vencer by default: expires today or within 30
 * days). A later delivery replaces an older one even when the older date
 * was inside the window. Sorted by expiry, then id.
 */
export const selectExpiringDocumentRows = (
  candidates: readonly ExpiringDocumentCandidate[],
  today: string,
  options: ExpiringDocumentQuery = {},
): ExpiringDocumentRow[] => {
  const wanted = options.status ?? "expiring";

  return latestDelivery(candidates)
    .flatMap((delivery) => {
      const status = statusOf({}, { expiresOn: delivery.expiresOn }, today);

      if (!isWindowStatus(status) || status !== wanted) {
        return [];
      }

      if (options.positionId && delivery.positionId !== options.positionId) {
        return [];
      }

      if (!delivery.expiresOn) {
        return [];
      }

      return [
        {
          id: delivery.id,
          personId: delivery.personId,
          personName: delivery.personName,
          positionId: delivery.positionId,
          positionName: delivery.positionName,
          requirementId: delivery.requirementId,
          requirementName: delivery.requirementName,
          deliveredOn: delivery.deliveredOn,
          expiresOn: delivery.expiresOn,
          status,
        },
      ];
    })
    .sort((left, right) => {
      if (left.expiresOn !== right.expiresOn) {
        return left.expiresOn < right.expiresOn ? -1 : 1;
      }

      return left.id < right.id ? -1 : 1;
    });
};
