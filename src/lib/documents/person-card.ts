import {
  latestDelivery,
  statusOf,
  type DocumentStatus,
  type DocumentStatusInput,
} from "./schema";

/**
 * The expediente «Documentos» card (WRK-I15-3). One row per active
 * requirement of the person's position. Company-wide requirements
 * (position_id null, the activation seed) are a different scope: the puesto
 * editor does not list them, and neither does this card.
 */

export const DOCUMENT_STATUS_LABELS = {
  missing: "Falta",
  valid: "Vigente",
  expiring: "Por vencer",
  expired: "Vencido",
} as const satisfies Record<DocumentStatus, string>;

export const PERSON_DOCUMENT_CARD_COPY = {
  emptyPosition: "Este puesto no tiene documentos requeridos.",
  emptyPerson: "Esta persona no tiene puesto.",
  ok: "Todo en orden.",
  missing: "Faltan documentos.",
  expiring: "Hay documentos por vencer.",
  expired: "Hay documentos vencidos.",
  error: "No se pudieron cargar los documentos.",
  readOnly: "Solo lectura.",
  noExpiry: "No vence",
  loading: "Cargando documentos",
} as const;

export type PersonDocumentCardState =
  "empty" | "ok" | "missing" | "expiring" | "expired" | "error";

export type PersonDocumentRow = {
  requirementId: string;
  name: string;
  required: boolean;
  validityMonths: number | null;
  status: DocumentStatus;
  deliveredOn: string | null;
  expiresOn: string | null;
};

export type PersonDocumentCardView = {
  state: PersonDocumentCardState;
  message: string;
  rows: PersonDocumentRow[];
};

export type PersonDocumentRequirementSlice = {
  id: string;
  name: string;
  required: boolean;
  validityMonths: number | null;
  sort: number;
};

export type PersonDocumentDeliverySlice = {
  personId: string;
  requirementId: string;
  deliveredOn: string;
  expiresOn: string | null;
  createdAt?: Date | string | null;
};

const SUMMARY: Record<Exclude<PersonDocumentCardState, "error">, string> = {
  empty: PERSON_DOCUMENT_CARD_COPY.emptyPosition,
  ok: PERSON_DOCUMENT_CARD_COPY.ok,
  missing: PERSON_DOCUMENT_CARD_COPY.missing,
  expiring: PERSON_DOCUMENT_CARD_COPY.expiring,
  expired: PERSON_DOCUMENT_CARD_COPY.expired,
};

/**
 * Card-level state. A worse date wins: vencido, then por vencer, then a
 * missing paper. «Todo en orden» is every row vigente.
 */
export const summarizePersonDocumentRows = (
  rows: readonly Pick<PersonDocumentRow, "status">[],
): { state: Exclude<PersonDocumentCardState, "error">; message: string } => {
  if (rows.length === 0) {
    return { state: "empty", message: SUMMARY.empty };
  }

  if (rows.some((row) => row.status === "expired")) {
    return { state: "expired", message: SUMMARY.expired };
  }

  if (rows.some((row) => row.status === "expiring")) {
    return { state: "expiring", message: SUMMARY.expiring };
  }

  if (rows.some((row) => row.status === "missing")) {
    return { state: "missing", message: SUMMARY.missing };
  }

  return { state: "ok", message: SUMMARY.ok };
};

/** A person with no puesto has nothing to list. */
export const personDocumentCardWithoutPosition =
  (): PersonDocumentCardView => ({
    state: "empty",
    message: PERSON_DOCUMENT_CARD_COPY.emptyPerson,
    rows: [],
  });

/**
 * Rows for the card. `today` is the company calendar date (`isoToday()`).
 * The chip uses the latest delivery of each requirement.
 */
export const buildPersonDocumentCard = (
  requirements: readonly PersonDocumentRequirementSlice[],
  deliveries: readonly PersonDocumentDeliverySlice[],
  today: string,
): PersonDocumentCardView => {
  const latestByRequirement = new Map(
    latestDelivery(deliveries).map((delivery) => [
      delivery.requirementId,
      delivery,
    ]),
  );
  const rows = [...requirements]
    .sort((left, right) => {
      if (left.sort !== right.sort) {
        return left.sort - right.sort;
      }

      return left.name.localeCompare(right.name, "es");
    })
    .map((requirement) => {
      const delivery = latestByRequirement.get(requirement.id) ?? null;
      const document: DocumentStatusInput = delivery
        ? { expiresOn: delivery.expiresOn }
        : null;

      return {
        requirementId: requirement.id,
        name: requirement.name,
        required: requirement.required,
        validityMonths: requirement.validityMonths,
        status: statusOf({ required: requirement.required }, document, today),
        deliveredOn: delivery?.deliveredOn ?? null,
        expiresOn: delivery?.expiresOn ?? null,
      };
    });
  const summary = summarizePersonDocumentRows(rows);

  return { ...summary, rows };
};
