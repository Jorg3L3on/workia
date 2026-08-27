import { asc, eq, isNull } from "drizzle-orm";

import { buildChanges, recordAuditEvent, snapshotSite } from "@/lib/audit";
import { db } from "@/lib/db";
import { sites } from "@/lib/db/schema";

import type { SiteFormValues } from "./schema";

export const listSites = async (options: { includeDeleted?: boolean } = {}) => {
  const filters = options.includeDeleted ? undefined : isNull(sites.deletedAt);

  return db
    .select()
    .from(sites)
    .where(filters)
    .orderBy(asc(sites.kind), asc(sites.name));
};

export const listActiveSites = async () => {
  return db
    .select()
    .from(sites)
    .where(isNull(sites.deletedAt))
    .orderBy(asc(sites.kind), asc(sites.name));
};

export const getSiteById = async (id: string) => {
  const [site] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return site ?? null;
};

export const createSite = async (
  input: SiteFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(sites)
    .values({
      name: input.name,
      kind: input.kind,
    })
    .returning();

  await recordAuditEvent({
    actorUserId,
    resourceType: "site",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotSite(created),
      summary: `Ubicación creada: ${created.name}`,
    },
  });

  return created;
};

export const updateSite = async (
  id: string,
  input: SiteFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getSiteById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotSite(existing);

  const [updated] = await db
    .update(sites)
    .set({
      name: input.name,
      kind: input.kind,
    })
    .where(eq(sites.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  const after = snapshotSite(updated);

  await recordAuditEvent({
    actorUserId,
    resourceType: "site",
    resourceId: id,
    action: "update",
    payload: {
      before,
      after,
      changes: buildChanges(before, after, ["name", "kind"]),
    },
  });

  return updated;
};

export const softDeleteSite = async (
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getSiteById(id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotSite(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(sites)
    .set({ deletedAt })
    .where(eq(sites.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    actorUserId,
    resourceType: "site",
    resourceId: id,
    action: "delete",
    payload: {
      before,
      after: snapshotSite(updated),
      summary: `Ubicación borrada lógicamente: ${existing.name}`,
    },
  });

  return updated;
};
