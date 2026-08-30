import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditEvents, users } from "@/lib/db/schema";

import type { AuditPayload } from "./types";
import type { ListAuditEventsOptions, RecordAuditEventInput } from "./types";

/** Append-only: audit events are inserted, never updated or deleted via the app. */
export const recordAuditEvent = async (input: RecordAuditEventInput) => {
  const [created] = await db
    .insert(auditEvents)
    .values({
      actorUserId: input.actorUserId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      result: input.result ?? "success",
      source: input.source ?? "app",
      payload: input.payload ?? null,
      requestMeta: input.requestMeta ?? null,
    })
    .returning();

  return created;
};

export const listAuditEvents = async (options: ListAuditEventsOptions = {}) => {
  const filters = [];

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

  if (options.from) {
    filters.push(gte(auditEvents.occurredAt, options.from));
  }

  if (options.to) {
    filters.push(lte(auditEvents.occurredAt, options.to));
  }

  const whereClause =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  return db
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
      payload: auditEvents.payload,
      requestMeta: auditEvents.requestMeta,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(whereClause)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(options.limit ?? 200)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        payload: row.payload as AuditPayload | null,
      })),
    );
};

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
  deletedAt: site.deletedAt,
});

export const snapshotContract = (contract: Record<string, unknown>) => ({
  personId: contract.personId,
  type: contract.type,
  startDate: contract.startDate,
  endDate: contract.endDate,
  noticeWindow: contract.noticeWindow,
  templateId: contract.templateId,
  templateName: contract.templateName,
  generatedText: contract.generatedText,
  scheduleEntrada: contract.scheduleEntrada,
  scheduleSalidaComer: contract.scheduleSalidaComer,
  scheduleRegresoComer: contract.scheduleRegresoComer,
  scheduleSalida: contract.scheduleSalida,
  status: contract.status,
  previousContractId: contract.previousContractId,
  deletedAt: contract.deletedAt,
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
