import type { PersonEventType } from "@/lib/db/schema";

import type { PersonEventInput } from "./index";

/**
 * The event of each kind of change (Workia 2.0 W2-13, docs/timeline.md). A
 * flow builds its event here and appends it with appendPersonEvents() in the
 * same transaction as the change and its audit event. The dedupe key names
 * the source row, so the backfill builds the very same key for the same fact
 * and never writes it twice.
 *
 * Payloads hold ids, dates and kinds only, in snake_case: who did it stays in
 * audit_events, and attendance is most of the rows on a 1 GB database.
 */

type Source = string;

/**
 * A calendar day as an instant: noon in central Mexico. Noon keeps the same
 * date in every Mexican time zone, so a timeline grouped by local day shows
 * an ingreso, a baja or a delivery on the day HR typed.
 */
export const dayInstant = (day: string) => new Date(`${day}T12:00:00-06:00`);

/** `<type>:<table>:<row id>[:<what>]`: the source row of the event. */
const rowKey = (
  type: Exclude<PersonEventType, "attendance">,
  table: string,
  id: string,
  what?: string,
) => `${type}:${table}:${id}${what ? `:${what}` : ""}`;

const compact = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

// ---------------------------------------------------------------- employment

export type EmploymentKind = "alta" | "cambio" | "baja" | "transfer";

type PeriodFact = {
  id: string;
  personId: string;
  fechaIngreso: string | null;
  fechaBaja: string | null;
  bajaSinFecha: boolean;
  createdAt: Date;
  updatedAt: Date;
  positionId?: string | null;
  siteId?: string | null;
  tipoBaja?: string | null;
  motivoBajaId?: string | null;
};

/** The ingreso of an employment period: one per period. */
export const employmentAltaEvent = (
  period: PeriodFact,
  source: Source,
  dims: { positionId?: string | null; siteId?: string | null } = {},
): PersonEventInput => ({
  personId: period.personId,
  type: "employment",
  occurredAt: period.fechaIngreso
    ? dayInstant(period.fechaIngreso)
    : period.createdAt,
  source,
  dedupeKey: rowKey("employment", "period", period.id, "alta"),
  payload: compact({
    kind: "alta",
    employment_period_id: period.id,
    date: period.fechaIngreso ?? undefined,
    position_id: dims.positionId ?? undefined,
    site_id: dims.siteId ?? undefined,
  }),
});

/**
 * The baja that closed an employment period: one per period. A baja «sin
 * fecha» (status set to baja without the dialog) happens when it is written.
 */
export const employmentBajaEvent = (
  period: PeriodFact,
  source: Source,
  at: Date = period.updatedAt,
): PersonEventInput => ({
  personId: period.personId,
  type: "employment",
  occurredAt: period.fechaBaja ? dayInstant(period.fechaBaja) : at,
  source,
  dedupeKey: rowKey("employment", "period", period.id, "baja"),
  payload: compact({
    kind: "baja",
    employment_period_id: period.id,
    date: period.fechaBaja ?? undefined,
    sin_fecha: period.bajaSinFecha || undefined,
    tipo: period.tipoBaja ?? undefined,
    motivo_id: period.motivoBajaId ?? undefined,
    position_id: period.positionId ?? undefined,
    site_id: period.siteId ?? undefined,
  }),
});

/**
 * A baja corrected after it was recorded (the importer gives a baja «sin
 * fecha» its date). The table is append-only, so the correction is a new
 * event keyed by its audit event.
 */
export const employmentBajaCorrectionEvent = (
  period: PeriodFact,
  auditEventId: string,
  source: Source,
): PersonEventInput => {
  const baja = employmentBajaEvent(period, source);

  return {
    ...baja,
    dedupeKey: rowKey("employment", "audit", auditEventId),
    payload: { ...baja.payload, corrected: true },
  };
};

/** Person fields whose change is an employment «cambio». */
export const EMPLOYMENT_DIMENSIONS = {
  positionId: "position_id",
  siteId: "site_id",
  areaId: "area_id",
  managerId: "manager_id",
} as const;

type AuditFact = {
  id: string;
  resourceType: string;
  resourceId: string;
  action: string;
  source: string;
  occurredAt: Date;
  payload: unknown;
};

/**
 * The «cambio» an audit event of a person describes: its puesto, sucursal,
 * área or jefe changed. Null for any other audit event. Live writes and the
 * backfill both go through here, keyed by the audit event id.
 */
export const employmentChangeFromAudit = (
  audit: AuditFact,
): PersonEventInput | null => {
  if (audit.resourceType !== "person" || audit.action === "create") {
    return null;
  }

  const changes = (audit.payload as { changes?: unknown } | null)?.changes;

  if (!changes || typeof changes !== "object") {
    return null;
  }

  const moved: Record<string, unknown> = {};

  for (const [field, column] of Object.entries(EMPLOYMENT_DIMENSIONS)) {
    const change = (changes as Record<string, unknown>)[field] as
      { from?: unknown; to?: unknown } | undefined;

    if (change && typeof change === "object" && change.from !== change.to) {
      moved[column] = change.to ?? null;
      moved[`from_${column}`] = change.from ?? null;
    }
  }

  if (Object.keys(moved).length === 0) {
    return null;
  }

  return {
    personId: audit.resourceId,
    type: "employment",
    occurredAt: audit.occurredAt,
    source: audit.source,
    dedupeKey: rowKey("employment", "audit", audit.id),
    payload: { kind: "cambio", ...moved },
  };
};

/**
 * One side of a transfer between subsidiaries (W2-24, docs/transfers.md):
 * the row the person left ("out") and the row they arrived at ("in") each get
 * one, keyed by the transfer, with the other side's ids. Together with the
 * baja of the closed period and the alta of the opened one, the group
 * timeline reads as one continuous history.
 */
export const employmentTransferEvent = (input: {
  personId: string;
  transferId: string;
  direction: "out" | "in";
  occurredAt: Date;
  source: Source;
  employmentPeriodId: string;
  otherCompanyId: string;
  otherPersonId: string;
}): PersonEventInput => ({
  personId: input.personId,
  type: "employment",
  occurredAt: input.occurredAt,
  source: input.source,
  dedupeKey: rowKey("employment", "transfer", input.transferId),
  payload: {
    kind: "transfer",
    direction: input.direction,
    employment_period_id: input.employmentPeriodId,
    ...(input.direction === "out"
      ? {
          to_company_id: input.otherCompanyId,
          to_person_id: input.otherPersonId,
        }
      : {
          from_company_id: input.otherCompanyId,
          from_person_id: input.otherPersonId,
        }),
  },
});

// ------------------------------------------------------------------ vacation

type VacationFact = {
  id: string;
  personId: string;
  employmentPeriodId: string | null;
  startDate: string;
  endDate: string;
  days: string;
  createdAt: Date;
  voidedAt: Date | null;
};

/** Days taken, as HR records them in vacation_records. On the first day. */
export const vacationEnjoymentEvent = (
  record: VacationFact,
  source: Source,
): PersonEventInput => ({
  personId: record.personId,
  type: "vacation",
  occurredAt: dayInstant(record.startDate),
  source,
  dedupeKey: rowKey("vacation", "record", record.id, "enjoyment"),
  payload: compact({
    kind: "enjoyment",
    vacation_record_id: record.id,
    employment_period_id: record.employmentPeriodId ?? undefined,
    days: Number(record.days),
    from: record.startDate,
    to: record.endDate,
  }),
});

/** A vacation_records row voided. When it was voided. */
export const vacationVoidEvent = (
  record: VacationFact & { voidedAt: Date },
  source: Source,
): PersonEventInput => ({
  personId: record.personId,
  type: "vacation",
  occurredAt: record.voidedAt,
  source,
  dedupeKey: rowKey("vacation", "record", record.id, "void"),
  payload: {
    kind: "void",
    vacation_record_id: record.id,
    days: Number(record.days),
    from: record.startDate,
    to: record.endDate,
  },
});

export type VacationRequestKind = "request" | "approval" | "rejection";

/**
 * A vacation request and its decision (W2-09/W2-10 write these in the
 * request's transaction), keyed by the request row and the step.
 */
export const vacationRequestEvent = (input: {
  personId: string;
  requestId: string;
  kind: VacationRequestKind;
  occurredAt: Date;
  source: Source;
  days: number;
  from: string;
  to: string;
  vacationRecordId?: string | null;
}): PersonEventInput => ({
  personId: input.personId,
  type: "vacation",
  occurredAt: input.occurredAt,
  source: input.source,
  dedupeKey: rowKey("vacation", "request", input.requestId, input.kind),
  payload: compact({
    kind: input.kind,
    request_id: input.requestId,
    days: input.days,
    from: input.from,
    to: input.to,
    vacation_record_id: input.vacationRecordId ?? undefined,
  }),
});

// ------------------------------------------------------------------ document

export type DocumentStatus = "uploaded" | "accepted" | "rejected" | "expired";

type DocumentFact = {
  id: string;
  personId: string;
  requirementId: string;
  deliveredOn: string;
  expiresOn: string | null;
};

/**
 * A paper of the expediente. HR recording a delivery date in
 * person_documents is an accepted paper, on the day it was handed in. The
 * employee upload and its review (W2-07) pass their own status.
 */
export const documentEvent = (
  document: DocumentFact,
  source: Source,
  status: DocumentStatus = "accepted",
  options: { occurredAt?: Date; reason?: string | null } = {},
): PersonEventInput => ({
  personId: document.personId,
  type: "document",
  occurredAt: options.occurredAt ?? dayInstant(document.deliveredOn),
  source,
  dedupeKey: rowKey("document", "person_document", document.id, status),
  payload: compact({
    status,
    person_document_id: document.id,
    requirement_id: document.requirementId,
    delivered_on: document.deliveredOn,
    expires_on: document.expiresOn ?? undefined,
    reason: options.reason ?? undefined,
  }),
});

// ------------------------------------------------------------------- receipt

/** A payroll receipt (W2-03 imports these), keyed by its CFDI UUID. */
export const receiptEvent = (input: {
  personId: string;
  cfdiUuid: string;
  period: string;
  deliveredAt: Date;
  source: Source;
  fileRef?: string | null;
}): PersonEventInput => ({
  personId: input.personId,
  type: "receipt",
  occurredAt: input.deliveredAt,
  source: input.source,
  dedupeKey: `receipt:cfdi:${input.cfdiUuid.toLowerCase()}`,
  payload: compact({
    period: input.period,
    cfdi_uuid: input.cfdiUuid.toLowerCase(),
    delivered_at: input.deliveredAt.toISOString(),
    file_ref: input.fileRef ?? undefined,
  }),
});

// ---------------------------------------------------------------- incidencia

export type IncidenciaKind = "falta" | "retardo" | "salida_anticipada";

export type IncidenciaInput = {
  personId: string;
  /** Local date, YYYY-MM-DD. */
  day: string;
  kind: IncidenciaKind;
  /** Pay period, a quincena: "2026-11-Q1" for the first of November (src/lib/pay-periods). */
  period: string;
  minutes?: number | null;
  justified?: boolean;
  justificationRef?: string | null;
  siteId?: string | null;
  source: Source;
};

/**
 * One incidencia of one day, from the engine (W2-14). The key holds the
 * period, the day and the kind, so a re-run of the engine writes nothing
 * twice; replacePeriodIncidencias() swaps a recomputed open period.
 */
export const incidenciaEvent = (input: IncidenciaInput): PersonEventInput => ({
  personId: input.personId,
  type: "incidencia",
  occurredAt: dayInstant(input.day),
  source: input.source,
  dedupeKey: `incidencia:${input.period}:${input.day}:${input.kind}`,
  payload: compact({
    date: input.day,
    kind: input.kind,
    period: input.period,
    minutes: input.minutes ?? undefined,
    justified: input.justified ?? false,
    justification_ref: input.justificationRef ?? undefined,
    site_id: input.siteId ?? undefined,
  }),
});
