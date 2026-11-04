/**
 * W2-04 review values of person_documents, in a file without Drizzle so
 * client components can import them.
 */
/** Review status of a delivery (W2-04). HR's own records are accepted. */
export const PERSON_DOCUMENT_STATUSES = [
  "uploaded",
  "accepted",
  "rejected",
] as const;
export type PersonDocumentStatus = (typeof PERSON_DOCUMENT_STATUSES)[number];

/** Closed list, so a rejection never carries free text (no health data). */
export const DOCUMENT_REJECTION_REASONS = [
  "illegible",
  "wrong_document",
  "expired",
  "incomplete",
  "wrong_person",
] as const;
export type DocumentRejectionReason =
  (typeof DOCUMENT_REJECTION_REASONS)[number];
