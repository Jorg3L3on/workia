import { createHash } from "node:crypto";
import {
  formatScheduleBlocks,
  readStoredBlocks,
} from "@/lib/people/schedule-blocks";

import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";

import { tdb, type DbExecutor } from "@/lib/db";
import { escapeLike } from "@/lib/db/like";
import { auditEvents, users } from "@/lib/db/schema";

import { currentAuditContext, noteAuditEvent } from "./context";
import { AUDIT_COMPENSATION_FIELDS, type AuditPayload } from "./types";
import type { ListAuditEventsOptions, RecordAuditEventInput } from "./types";

/**
 * Append-only: audit events are inserted, never updated or deleted via the app.
 * Inside an MCP tool (runWithAuditContext) the source and request meta come
 * from the context unless the caller passes them.
 */
export const recordAuditEvent = async (
  input: RecordAuditEventInput,
  executor: DbExecutor = tdb(input.companyId),
) => {
  const context = currentAuditContext();
  const [created] = await executor
    .insert(auditEvents)
    .values({
      companyId: input.companyId,
      actorUserId: input.actorUserId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      result: input.result ?? "success",
      source: input.source ?? context?.source ?? "app",
      payload: input.payload ?? null,
      requestMeta: input.requestMeta ?? context?.requestMeta ?? null,
    })
    .returning();

  if (created) {
    noteAuditEvent(created.id);
  }

  return created;
};

const buildAuditFilters = (options: ListAuditEventsOptions) => {
  const filters = [eq(auditEvents.companyId, options.companyId)];

  if (options.resourceType) {
    filters.push(eq(auditEvents.resourceType, options.resourceType));
  }

  if (options.resourceId) {
    filters.push(eq(auditEvents.resourceId, options.resourceId));
  }

  if (options.actorUserId) {
    filters.push(eq(auditEvents.actorUserId, options.actorUserId));
  }

  if (options.action) {
    filters.push(eq(auditEvents.action, options.action));
  }

  if (options.source) {
    filters.push(eq(auditEvents.source, options.source));
  }

  if (options.from) {
    filters.push(gte(auditEvents.occurredAt, options.from));
  }

  if (options.to) {
    filters.push(lte(auditEvents.occurredAt, options.to));
  }

  const query = options.query?.trim();

  if (query) {
    const term = `%${escapeLike(query)}%`;
    // A subquery for the actor, so the count needs no join.
    filters.push(
      or(
        sql`(${auditEvents.payload} -> 'summary')::text ilike ${term}`,
        sql`(${auditEvents.payload} -> 'changes')::text ilike ${term}`,
        sql`exists (select 1 from ${users} where ${users.id} = ${auditEvents.actorUserId} and (${users.name} ilike ${term} or ${users.email} ilike ${term}))`,
      )!,
    );
  }

  return and(...filters);
};

export const countAuditEvents = async (options: ListAuditEventsOptions) => {
  const [row] = await tdb(options.companyId)
    .select({ total: count() })
    .from(auditEvents)
    .where(buildAuditFilters(options));

  return row?.total ?? 0;
};

export const listAuditEvents = async (options: ListAuditEventsOptions) => {
  const whereClause = buildAuditFilters(options);

  return tdb(options.companyId)
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      action: auditEvents.action,
      result: auditEvents.result,
      source: auditEvents.source,
      // Lists only render summary and changes; skip before/after snapshots.
      payload: sql<AuditPayload | null>`case when ${auditEvents.payload} is null then null else jsonb_strip_nulls(jsonb_build_object('summary', ${auditEvents.payload} -> 'summary', 'changes', ${auditEvents.payload} -> 'changes')) end`,
      requestMeta: auditEvents.requestMeta,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(whereClause)
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        payload: options.compensation
          ? (row.payload as AuditPayload | null)
          : maskAuditCompensation(row.payload as AuditPayload | null),
      })),
    );
};

const COMPENSATION_MASK = "•••";
const compensationKeys = new Set<string>(AUDIT_COMPENSATION_FIELDS);

const maskAmount = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? value
    : COMPENSATION_MASK;

/**
 * Payroll amounts (salaries, finiquito) of an audit payload as «•••», at any
 * depth: for a viewer without compensation:read (Historial, Auditoría, MCP).
 */
export const maskAuditCompensation = <T>(payload: T): T => {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== "object" || node instanceof Date) {
      return node;
    }

    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (!compensationKeys.has(key)) {
          return [key, walk(value)];
        }

        if (
          value &&
          typeof value === "object" &&
          ("from" in value || "to" in value)
        ) {
          const change = value as { from?: unknown; to?: unknown };
          return [
            key,
            { from: maskAmount(change.from), to: maskAmount(change.to) },
          ];
        }

        return [key, maskAmount(value)];
      }),
    );
  };

  return walk(payload) as T;
};

/** Users who have acted in this company, for the actor filter (never other companies' users). */
export const listAuditActors = async (companyId: string) =>
  tdb(companyId)
    .selectDistinct({ id: users.id, name: users.name, email: users.email })
    .from(auditEvents)
    .innerJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(eq(auditEvents.companyId, companyId))
    .orderBy(users.name);

export const buildChanges = <T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[],
) => {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of fields) {
    const fromValue = before[field];
    const toValue = after[field];

    if (fromValue !== toValue) {
      changes[String(field)] = { from: fromValue, to: toValue };
    }
  }

  return changes;
};

/** Expediente México fields kept in person audit snapshots (WRK-I5-1). */
export const MEXICO_AUDIT_FIELDS = [
  "domicilioCalle",
  "domicilioNumeroExterior",
  "domicilioNumeroInterior",
  "domicilioColonia",
  "domicilioMunicipio",
  "domicilioEstado",
  "domicilioCodigoPostal",
  "estadoCivil",
  "sexo",
  "lugarNacimiento",
  "nacionalidad",
  "ineClaveElector",
] as const;

export const snapshotPerson = (person: Record<string, unknown>) => ({
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  apellidoMaterno: person.apellidoMaterno,
  email: person.email,
  telefono: person.telefono,
  fechaNacimiento: person.fechaNacimiento,
  fechaIngreso: person.fechaIngreso,
  areaId: person.areaId,
  positionId: person.positionId,
  managerId: person.managerId,
  siteId: person.siteId,
  rfc: person.rfc,
  curp: person.curp,
  nss: person.nss,
  status: person.status,
  deletedAt: person.deletedAt,
  ...(Object.fromEntries(
    MEXICO_AUDIT_FIELDS.map((field) => [field, person[field] ?? null]),
  ) as Record<(typeof MEXICO_AUDIT_FIELDS)[number], unknown>),
});

export const snapshotPersonSchedule = (
  schedule: Record<string, unknown> | null,
) => {
  if (!schedule) {
    return null;
  }

  return {
    entrada: schedule.entrada,
    salidaComer: schedule.salidaComer,
    regresoComer: schedule.regresoComer,
    salida: schedule.salida,
    // Readable text, so a change of blocks compares as one value (WRK-I5-3).
    bloques: Array.isArray(schedule.blocks)
      ? formatScheduleBlocks(
          readStoredBlocks(schedule.blocks, schedule.restDay as string | null),
        )
      : null,
    deletedAt: schedule.deletedAt,
  };
};

export const snapshotArea = (area: Record<string, unknown>) => ({
  name: area.name,
  parentAreaId: area.parentAreaId,
  active: area.active,
  deletedAt: area.deletedAt,
});

export const snapshotPosition = (position: Record<string, unknown>) => ({
  name: position.name,
  areaId: position.areaId,
  active: position.active,
  deletedAt: position.deletedAt,
});

export const snapshotActivity = (activity: Record<string, unknown>) => ({
  name: activity.name,
  active: activity.active,
  deletedAt: activity.deletedAt,
});

export const snapshotPositionActivity = (
  assignment: Record<string, unknown>,
) => ({
  positionId: assignment.positionId,
  activityId: assignment.activityId,
  positionName: assignment.positionName,
  activityName: assignment.activityName,
});

export const snapshotSite = (site: Record<string, unknown>) => ({
  name: site.name,
  kind: site.kind,
  regionId: site.regionId ?? null,
  deletedAt: site.deletedAt,
});

export const snapshotTerminationReason = (reason: Record<string, unknown>) => ({
  name: reason.name,
  classification: reason.classification ?? null,
  active: reason.active,
  deletedAt: reason.deletedAt,
});

/**
 * An employment period as Historial compares it (Iniciativa 2); the motivo by
 * name so the history reads without the catalog. finiquitoMonto is payroll
 * data: lists mask it without compensation:read.
 */
export const snapshotEmploymentPeriod = (
  period: Record<string, unknown>,
  motivoName?: string | null,
) => ({
  fechaIngreso: period.fechaIngreso ?? null,
  reconoceAntiguedad: period.reconoceAntiguedad ?? false,
  fechaAntiguedadReconocida: period.fechaAntiguedadReconocida ?? null,
  fechaAntiguedad: period.fechaAntiguedad ?? null,
  fechaBaja: period.fechaBaja ?? null,
  tipoBaja: period.tipoBaja ?? null,
  motivoBaja: motivoName ?? null,
  comentarioBaja: period.comentarioBaja ?? null,
  recontratable: period.recontratable ?? null,
  finiquitoEstado: period.finiquitoEstado ?? null,
  finiquitoFecha: period.finiquitoFecha ?? null,
  finiquitoMonto: period.finiquitoMonto ?? null,
});

export const snapshotRegion = (region: Record<string, unknown>) => ({
  name: region.name,
  active: region.active,
  deletedAt: region.deletedAt,
});

const summarizeGeneratedText = (text: unknown) =>
  typeof text === "string"
    ? {
        generatedTextLength: text.length,
        generatedTextHash: createHash("sha256")
          .update(text)
          .digest("hex")
          .slice(0, 16),
      }
    : { generatedTextLength: null, generatedTextHash: null };

export const snapshotContract = (contract: Record<string, unknown>) => ({
  personId: contract.personId,
  type: contract.type,
  startDate: contract.startDate,
  endDate: contract.endDate,
  noticeWindow: contract.noticeWindow,
  templateId: contract.templateId,
  templateName: contract.templateName,
  // The full text lives on the contract row; audit keeps only its size and hash.
  ...summarizeGeneratedText(contract.generatedText),
  scheduleEntrada: contract.scheduleEntrada,
  scheduleSalidaComer: contract.scheduleSalidaComer,
  scheduleRegresoComer: contract.scheduleRegresoComer,
  scheduleSalida: contract.scheduleSalida,
  status: contract.status,
  salarioDiario: contract.salarioDiario ?? null,
  salarioMensual: contract.salarioMensual ?? null,
  formaPago: contract.formaPago ?? null,
  periodicidadPago: contract.periodicidadPago ?? null,
  previousContractId: contract.previousContractId,
  noRenewReason: contract.noRenewReason ?? null,
  deletedAt: contract.deletedAt,
});

export const snapshotDocumentRequirement = (
  requirement: Record<string, unknown>,
) => ({
  name: requirement.name,
  positionId: requirement.positionId ?? null,
  required: requirement.required,
  validityMonths: requirement.validityMonths ?? null,
  sort: requirement.sort,
  active: requirement.active,
  deletedAt: requirement.deletedAt ?? null,
});

export const snapshotPersonDocument = (document: Record<string, unknown>) => ({
  personId: document.personId,
  requirementId: document.requirementId,
  deliveredOn: document.deliveredOn,
  expiresOn: document.expiresOn ?? null,
});

export const snapshotVacationRecord = (record: {
  personId: string;
  employmentPeriodId?: string | null;
  serviceYear: number;
  startDate: string;
  endDate: string;
  days: string;
  note?: string | null;
  voidedAt?: Date | string | null;
}) => ({
  personId: record.personId,
  employmentPeriodId: record.employmentPeriodId ?? null,
  serviceYear: record.serviceYear,
  startDate: record.startDate,
  endDate: record.endDate,
  days: record.days,
  note: record.note ?? null,
  voidedAt:
    record.voidedAt instanceof Date
      ? record.voidedAt.toISOString()
      : (record.voidedAt ?? null),
});

export const snapshotContractTemplate = (
  template: Record<string, unknown>,
) => ({
  name: template.name,
  body: template.body,
  active: template.active,
  deletedAt: template.deletedAt,
});

export const snapshotAsset = (asset: Record<string, unknown>) => ({
  name: asset.name,
  identifier: asset.identifier,
  category: asset.category,
  tracksHistory: asset.tracksHistory,
  holderId: asset.holderId,
  conditionNote: asset.conditionNote,
  status: asset.status,
  deletedAt: asset.deletedAt,
});

export const snapshotAssetMovement = (movement: Record<string, unknown>) => ({
  assetId: movement.assetId,
  type: movement.type,
  personId: movement.personId,
  movementDate: movement.movementDate,
  conditionNote: movement.conditionNote,
  notes: movement.notes,
});

export type ListAuditEventsKeysetOptions = Omit<
  ListAuditEventsOptions,
  "companyId" | "limit" | "offset"
> & {
  source?: NonNullable<RecordAuditEventInput["source"]>;
  /** Keyset position: before (occurred_at as text, id). */
  after?: { key: string; id: string } | null;
  limit: number;
};

/**
 * Audit events newest first in a stable order (occurred_at, id) for cursor
 * paging, with the full payload (callers mask PII). Read only; used by the MCP
 * list_audit_events.
 */
export const listAuditEventsKeyset = async (
  companyId: string,
  options: ListAuditEventsKeysetOptions,
) => {
  const filters = [
    buildAuditFilters({ ...options, companyId }),
    options.after
      ? sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${options.after.key}::timestamptz, ${options.after.id}::uuid)`
      : undefined,
  ];

  return tdb(companyId)
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorName: users.name,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      action: auditEvents.action,
      result: auditEvents.result,
      source: auditEvents.source,
      payload: auditEvents.payload,
      requestMeta: auditEvents.requestMeta,
      occurredAt: auditEvents.occurredAt,
      sortKey: sql<string>`${auditEvents.occurredAt}::text`,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(and(...filters))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(options.limit + 1);
};
