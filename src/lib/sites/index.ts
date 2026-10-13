import { asc, eq, isNull } from "drizzle-orm";

import { buildChanges, recordAuditEvent, snapshotSite } from "@/lib/audit";
import { db } from "@/lib/db";
import { rethrowDuplicate } from "@/lib/db/errors";
import { sites } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import type { SiteFormValues } from "./schema";

export const listSites = async (
  companyId: string,
  options: { includeDeleted?: boolean } = {},
) => {
  return db
    .select()
    .from(sites)
    .where(
      withTenant(
        sites,
        companyId,
        options.includeDeleted ? undefined : isNull(sites.deletedAt),
      ),
    )
    .orderBy(asc(sites.kind), asc(sites.name));
};

export const listActiveSites = async (companyId: string) => {
  return db
    .select()
    .from(sites)
    .where(withTenant(sites, companyId, isNull(sites.deletedAt)))
    .orderBy(asc(sites.kind), asc(sites.name));
};

export const getSiteById = async (companyId: string, id: string) => {
  const [site] = await db
    .select()
    .from(sites)
    .where(withTenant(sites, companyId, eq(sites.id, id)))
    .limit(1);
  return site ?? null;
};

export const createSite = async (
  companyId: string,
  input: SiteFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await db
    .insert(sites)
    .values({
      companyId,
      name: input.name,
      kind: input.kind,
    })
    .returning()
    .catch(rethrowDuplicate("Ya existe una ubicación activa con ese nombre."));

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  input: SiteFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getSiteById(companyId, id);

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
    .where(withTenant(sites, companyId, eq(sites.id, id)))
    .returning()
    .catch(rethrowDuplicate("Ya existe una ubicación activa con ese nombre."));

  if (!updated) {
    return null;
  }

  const after = snapshotSite(updated);

  await recordAuditEvent({
    companyId,
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
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getSiteById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotSite(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(sites)
    .set({ deletedAt })
    .where(withTenant(sites, companyId, eq(sites.id, id)))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    companyId,
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
