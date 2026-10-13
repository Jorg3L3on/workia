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
import { withTenant } from "@/lib/tenant/scope";
import {
  activities,
  areas,
  people,
  positionActivities,
  positions,
} from "@/lib/db/schema";

import {
  isActivityAssignable,
  type ActivityFormValues,
  type AreaFormValues,
  type PositionFormValues,
} from "./schema";

export const listAreas = async (
  companyId: string,
  options: { includeDeleted?: boolean } = {},
) => {
  return db
    .select()
    .from(areas)
    .where(
      withTenant(
        areas,
        companyId,
        options.includeDeleted ? undefined : isNull(areas.deletedAt),
      ),
    )
    .orderBy(asc(areas.name));
};

export const listActiveAreas = async (companyId: string) => {
  return db
    .select()
    .from(areas)
    .where(
      withTenant(
        areas,
        companyId,
        isNull(areas.deletedAt),
        eq(areas.active, true),
      ),
    )
    .orderBy(asc(areas.name));
};

export const getAreaById = async (companyId: string, id: string) => {
  const [area] = await db
    .select()
    .from(areas)
    .where(withTenant(areas, companyId, eq(areas.id, id)))
    .limit(1);
  return area ?? null;
};

export const createArea = async (
  companyId: string,
  input: AreaFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(areas)
    .values({
      companyId,
      name: input.name,
      parentAreaId: input.parentAreaId?.trim() ? input.parentAreaId : null,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  input: AreaFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getAreaById(companyId, id);

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
    .where(withTenant(areas, companyId, eq(areas.id, id)))
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
    companyId,
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
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getAreaById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotArea(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(areas)
    .set({ deletedAt, active: false })
    .where(withTenant(areas, companyId, eq(areas.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  options: { includeDeleted?: boolean; areaId?: string } = {},
) => {
  const filters = [eq(positions.companyId, companyId)];

  if (!options.includeDeleted) {
    filters.push(isNull(positions.deletedAt));
  }

  if (options.areaId) {
    filters.push(eq(positions.areaId, options.areaId));
  }

  return db
    .select()
    .from(positions)
    .where(and(...filters))
    .orderBy(asc(positions.name));
};

export const listActivePositions = async (
  companyId: string,
  areaId?: string,
) => {
  const filters = [
    eq(positions.companyId, companyId),
    isNull(positions.deletedAt),
    eq(positions.active, true),
  ];

  if (areaId) {
    filters.push(eq(positions.areaId, areaId));
  }

  return db
    .select()
    .from(positions)
    .where(and(...filters))
    .orderBy(asc(positions.name));
};

export const getPositionById = async (companyId: string, id: string) => {
  const [position] = await db
    .select()
    .from(positions)
    .where(withTenant(positions, companyId, eq(positions.id, id)))
    .limit(1);

  return position ?? null;
};

export const createPosition = async (
  companyId: string,
  input: PositionFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(positions)
    .values({
      companyId,
      name: input.name,
      areaId: input.areaId?.trim() ? input.areaId : null,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  input: PositionFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getPositionById(companyId, id);

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
    .where(withTenant(positions, companyId, eq(positions.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotPosition(updated);
  const changes = buildChanges(before, after, ["name", "areaId", "active"]);

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getPositionById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotPosition(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(positions)
    .set({ deletedAt, active: false })
    .where(withTenant(positions, companyId, eq(positions.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  options: { includeDeleted?: boolean } = {},
) => {
  return db
    .select()
    .from(activities)
    .where(
      withTenant(
        activities,
        companyId,
        options.includeDeleted ? undefined : isNull(activities.deletedAt),
      ),
    )
    .orderBy(asc(activities.name));
};

export const listAssignableActivities = async (companyId: string) => {
  return db
    .select()
    .from(activities)
    .where(
      withTenant(
        activities,
        companyId,
        isNull(activities.deletedAt),
        eq(activities.active, true),
      ),
    )
    .orderBy(asc(activities.name));
};

export const getActivityById = async (companyId: string, id: string) => {
  const [activity] = await db
    .select()
    .from(activities)
    .where(withTenant(activities, companyId, eq(activities.id, id)))
    .limit(1);

  return activity ?? null;
};

export const createActivity = async (
  companyId: string,
  input: ActivityFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(activities)
    .values({
      companyId,
      name: input.name,
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  input: ActivityFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getActivityById(companyId, id);

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
    .where(withTenant(activities, companyId, eq(activities.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotActivity(updated);
  const changes = buildChanges(before, after, ["name", "active"]);

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getActivityById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotActivity(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(activities)
    .set({ deletedAt, active: false })
    .where(withTenant(activities, companyId, eq(activities.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    companyId,
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

export const listActivitiesByPositionIds = async (
  companyId: string,
  positionIds: string[],
) => {
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
      withTenant(
        positionActivities,
        companyId,
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

export const listActivitiesForPosition = async (
  companyId: string,
  positionId: string,
) => {
  const grouped = await listActivitiesByPositionIds(companyId, [positionId]);
  return grouped.get(positionId) ?? [];
};

/** Activities of the person's position, resolved by person id so pages can fetch them in parallel with the person. */
export const listActivitiesForPersonPosition = async (
  companyId: string,
  personId: string,
) =>
  db
    .select({
      id: activities.id,
      name: activities.name,
      active: activities.active,
    })
    .from(people)
    .innerJoin(
      positionActivities,
      eq(positionActivities.positionId, people.positionId),
    )
    .innerJoin(activities, eq(positionActivities.activityId, activities.id))
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(activities.deletedAt),
      ),
    )
    .orderBy(asc(activities.name));

export const assignActivityToPosition = async (
  companyId: string,
  positionId: string,
  activityId: string,
  actorUserId?: string | null,
) => {
  const [position, activity] = await Promise.all([
    getPositionById(companyId, positionId),
    getActivityById(companyId, activityId),
  ]);

  if (!position || position.deletedAt) {
    return { ok: false as const, reason: "position-missing" };
  }

  if (!activity || !isActivityAssignable(activity)) {
    return { ok: false as const, reason: "activity-not-assignable" };
  }

  const [inserted] = await db
    .insert(positionActivities)
    .values({ companyId, positionId, activityId })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await recordAuditEvent({
      companyId,
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
  companyId: string,
  positionId: string,
  activityId: string,
  actorUserId?: string | null,
) => {
  const [position, activity] = await Promise.all([
    getPositionById(companyId, positionId),
    getActivityById(companyId, activityId),
  ]);

  const [removed] = await db
    .delete(positionActivities)
    .where(
      withTenant(
        positionActivities,
        companyId,
        eq(positionActivities.positionId, positionId),
        eq(positionActivities.activityId, activityId),
      ),
    )
    .returning();

  if (removed) {
    await recordAuditEvent({
      companyId,
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
