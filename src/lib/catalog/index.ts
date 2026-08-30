import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotActivity,
  snapshotArea,
  snapshotPosition,
  snapshotPositionActivity,
} from "@/lib/audit";
import { db } from "@/lib/db";
import {
  activities,
  areas,
  positionActivities,
  positions,
} from "@/lib/db/schema";

import {
  isActivityAssignable,
  type ActivityFormValues,
  type AreaFormValues,
  type PositionFormValues,
} from "./schema";

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

export const listActivities = async (
  options: { includeDeleted?: boolean } = {},
) => {
  const filters = options.includeDeleted
    ? undefined
    : isNull(activities.deletedAt);

  return db
    .select()
    .from(activities)
    .where(filters)
    .orderBy(asc(activities.name));
};

export const listAssignableActivities = async () => {
  return db
    .select()
    .from(activities)
    .where(and(isNull(activities.deletedAt), eq(activities.active, true)))
    .orderBy(asc(activities.name));
};

export const getActivityById = async (id: string) => {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);

  return activity ?? null;
};

export const createActivity = async (
  input: ActivityFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(activities)
    .values({
      name: input.name,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    actorUserId,
    resourceType: "activity",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotActivity(created),
      summary: `Actividad creada: ${created.name}`,
    },
  });

  return created;
};

export const updateActivity = async (
  id: string,
  input: ActivityFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getActivityById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotActivity(existing);

  const [updated] = await db
    .update(activities)
    .set({
      name: input.name,
      active: input.active,
    })
    .where(eq(activities.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotActivity(updated);
  const changes = buildChanges(before, after, ["name", "active"]);

  await recordAuditEvent({
    actorUserId,
    resourceType: "activity",
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

export const softDeleteActivity = async (
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getActivityById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotActivity(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(activities)
    .set({ deletedAt, active: false })
    .where(eq(activities.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    actorUserId,
    resourceType: "activity",
    resourceId: id,
    action: "delete",
    payload: {
      before,
      after: snapshotActivity(updated),
      summary: `Actividad borrada lógicamente: ${existing.name}`,
    },
  });

  return updated;
};

export const listActivitiesByPositionIds = async (positionIds: string[]) => {
  const grouped = new Map<
    string,
    Array<{ id: string; name: string; active: boolean }>
  >();

  for (const positionId of positionIds) {
    grouped.set(positionId, []);
  }

  if (positionIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      positionId: positionActivities.positionId,
      id: activities.id,
      name: activities.name,
      active: activities.active,
    })
    .from(positionActivities)
    .innerJoin(activities, eq(positionActivities.activityId, activities.id))
    .where(
      and(
        inArray(positionActivities.positionId, positionIds),
        isNull(activities.deletedAt),
      ),
    )
    .orderBy(asc(activities.name));

  for (const row of rows) {
    grouped.get(row.positionId)?.push({
      id: row.id,
      name: row.name,
      active: row.active,
    });
  }

  return grouped;
};

export const listActivitiesForPosition = async (positionId: string) => {
  const grouped = await listActivitiesByPositionIds([positionId]);
  return grouped.get(positionId) ?? [];
};

export const assignActivityToPosition = async (
  positionId: string,
  activityId: string,
  actorUserId?: string | null,
) => {
  const [position, activity] = await Promise.all([
    getPositionById(positionId),
    getActivityById(activityId),
  ]);

  if (!position || position.deletedAt) {
    return { ok: false as const, reason: "position-missing" };
  }

  if (!activity || !isActivityAssignable(activity)) {
    return { ok: false as const, reason: "activity-not-assignable" };
  }

  const [inserted] = await db
    .insert(positionActivities)
    .values({ positionId, activityId })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await recordAuditEvent({
      actorUserId,
      resourceType: "position_activity",
      resourceId: `${positionId}:${activityId}`,
      action: "link",
      payload: {
        after: snapshotPositionActivity({
          positionId,
          activityId,
          positionName: position.name,
          activityName: activity.name,
        }),
        summary: `Actividad asignada: ${activity.name} → ${position.name}`,
      },
    });
  }

  return { ok: true as const, created: Boolean(inserted) };
};

export const unassignActivityFromPosition = async (
  positionId: string,
  activityId: string,
  actorUserId?: string | null,
) => {
  const [position, activity] = await Promise.all([
    getPositionById(positionId),
    getActivityById(activityId),
  ]);

  const [removed] = await db
    .delete(positionActivities)
    .where(
      and(
        eq(positionActivities.positionId, positionId),
        eq(positionActivities.activityId, activityId),
      ),
    )
    .returning();

  if (removed) {
    await recordAuditEvent({
      actorUserId,
      resourceType: "position_activity",
      resourceId: `${positionId}:${activityId}`,
      action: "unlink",
      payload: {
        before: snapshotPositionActivity({
          positionId,
          activityId,
          positionName: position?.name ?? null,
          activityName: activity?.name ?? null,
        }),
        summary: `Actividad desasignada: ${activity?.name ?? activityId} ← ${position?.name ?? positionId}`,
      },
    });
  }

  return { ok: true as const, removed: Boolean(removed) };
};
