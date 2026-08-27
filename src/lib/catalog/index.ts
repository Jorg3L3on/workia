import { and, asc, eq, isNull } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotArea,
  snapshotPosition,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { areas, positions } from "@/lib/db/schema";

import type { AreaFormValues, PositionFormValues } from "./schema";

export const listAreas = async (options: { includeDeleted?: boolean } = {}) => {
  const filters = options.includeDeleted ? undefined : isNull(areas.deletedAt);

  return db.select().from(areas).where(filters).orderBy(asc(areas.name));
};

export const listActiveAreas = async () => {
  return db
    .select()
    .from(areas)
    .where(and(isNull(areas.deletedAt), eq(areas.active, true)))
    .orderBy(asc(areas.name));
};

export const getAreaById = async (id: string) => {
  const [area] = await db.select().from(areas).where(eq(areas.id, id)).limit(1);
  return area ?? null;
};

export const createArea = async (
  input: AreaFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(areas)
    .values({
      name: input.name,
      parentAreaId: input.parentAreaId?.trim() ? input.parentAreaId : null,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    actorUserId,
    resourceType: "area",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotArea(created),
      summary: `Área creada: ${created.name}`,
    },
  });

  return created;
};

export const updateArea = async (
  id: string,
  input: AreaFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getAreaById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotArea(existing);

  const [updated] = await db
    .update(areas)
    .set({
      name: input.name,
      parentAreaId: input.parentAreaId?.trim() ? input.parentAreaId : null,
      active: input.active,
    })
    .where(eq(areas.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotArea(updated);
  const changes = buildChanges(before, after, [
    "name",
    "parentAreaId",
    "active",
  ]);

  await recordAuditEvent({
    actorUserId,
    resourceType: "area",
    resourceId: id,
    action:
      input.active !== existing.active
        ? input.active
          ? "activate"
          : "deactivate"
        : "update",
    payload: { before, after, changes },
  });

  return updated;
};

export const softDeleteArea = async (
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getAreaById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotArea(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(areas)
    .set({ deletedAt, active: false })
    .where(eq(areas.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    actorUserId,
    resourceType: "area",
    resourceId: id,
    action: "delete",
    payload: {
      before,
      after: snapshotArea(updated),
      summary: `Área borrada lógicamente: ${existing.name}`,
    },
  });

  return updated;
};

export const listPositions = async (
  options: { includeDeleted?: boolean; areaId?: string } = {},
) => {
  const filters = [];

  if (!options.includeDeleted) {
    filters.push(isNull(positions.deletedAt));
  }

  if (options.areaId) {
    filters.push(eq(positions.areaId, options.areaId));
  }

  const whereClause =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  return db
    .select()
    .from(positions)
    .where(whereClause)
    .orderBy(asc(positions.name));
};

export const listActivePositions = async (areaId?: string) => {
  const filters = [isNull(positions.deletedAt), eq(positions.active, true)];

  if (areaId) {
    filters.push(eq(positions.areaId, areaId));
  }

  return db
    .select()
    .from(positions)
    .where(and(...filters))
    .orderBy(asc(positions.name));
};

export const getPositionById = async (id: string) => {
  const [position] = await db
    .select()
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);

  return position ?? null;
};

export const createPosition = async (
  input: PositionFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(positions)
    .values({
      name: input.name,
      areaId: input.areaId?.trim() ? input.areaId : null,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    actorUserId,
    resourceType: "position",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotPosition(created),
      summary: `Puesto creado: ${created.name}`,
    },
  });

  return created;
};

export const updatePosition = async (
  id: string,
  input: PositionFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getPositionById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotPosition(existing);

  const [updated] = await db
    .update(positions)
    .set({
      name: input.name,
      areaId: input.areaId?.trim() ? input.areaId : null,
      active: input.active,
    })
    .where(eq(positions.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotPosition(updated);
  const changes = buildChanges(before, after, ["name", "areaId", "active"]);

  await recordAuditEvent({
    actorUserId,
    resourceType: "position",
    resourceId: id,
    action:
      input.active !== existing.active
        ? input.active
          ? "activate"
          : "deactivate"
        : "update",
    payload: { before, after, changes },
  });

  return updated;
};

export const softDeletePosition = async (
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getPositionById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotPosition(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(positions)
    .set({ deletedAt, active: false })
    .where(eq(positions.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    actorUserId,
    resourceType: "position",
    resourceId: id,
    action: "delete",
    payload: {
      before,
      after: snapshotPosition(updated),
      summary: `Puesto borrado lógicamente: ${existing.name}`,
    },
  });

  return updated;
};
