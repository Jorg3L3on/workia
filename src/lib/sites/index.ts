import { and, asc, eq, isNull } from "drizzle-orm";

import { buildChanges, recordAuditEvent, snapshotSite } from "@/lib/audit";
import { tdb } from "@/lib/db";
import { rethrowDuplicate } from "@/lib/db/errors";
import { regions, sites } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import type { SiteFormValues } from "./schema";

export const listSites = async (
  companyId: string,
  options: { includeDeleted?: boolean } = {},
) => {
  return tdb(companyId)
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
  return tdb(companyId)
    .select()
    .from(sites)
    .where(withTenant(sites, companyId, isNull(sites.deletedAt)))
    .orderBy(asc(sites.kind), asc(sites.name));
};

export const getSiteById = async (companyId: string, id: string) => {
  const [site] = await tdb(companyId)
    .select()
    .from(sites)
    .where(withTenant(sites, companyId, eq(sites.id, id)))
    .limit(1);
  return site ?? null;
};

/** Thrown when a site points at a region that is not an active one of its company. */
export class RegionNotFoundError extends Error {
  constructor() {
    super("La región elegida no existe en esta empresa o está inactiva.");
    this.name = "RegionNotFoundError";
  }
}

const assertActiveRegion = async (companyId: string, regionId: string) => {
  const [region] = await tdb(companyId)
    .select({ id: regions.id })
    .from(regions)
    .where(
      withTenant(
        regions,
        companyId,
        and(
          eq(regions.id, regionId),
          isNull(regions.deletedAt),
          eq(regions.active, true),
        ),
      ),
    )
    .limit(1);

  if (!region) {
    throw new RegionNotFoundError();
  }
};

export const createSite = async (
  companyId: string,
  input: SiteFormValues,
  actorUserId?: string | null,
) => {
  const regionId = input.regionId || null;

  if (regionId) {
    await assertActiveRegion(companyId, regionId);
  }

  const [created] = await tdb(companyId)
    .insert(sites)
    .values({
      companyId,
      name: input.name,
      kind: input.kind,
      regionId,
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

  const [updated] = await tdb(companyId)
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

  const [updated] = await tdb(companyId)
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

/** Moves a site to a region, or out of any (null). Audited as a site update. */
export const setSiteRegion = async (
  companyId: string,
  siteId: string,
  regionId: string | null,
  actorUserId?: string | null,
) => {
  const existing = await getSiteById(companyId, siteId);

  if (!existing || existing.deletedAt) {
    return null;
  }

  if (regionId) {
    await assertActiveRegion(companyId, regionId);
  }

  if ((existing.regionId ?? null) === regionId) {
    return existing;
  }

  const [updated] = await tdb(companyId)
    .update(sites)
    .set({ regionId })
    .where(withTenant(sites, companyId, eq(sites.id, siteId)))
    .returning();

  if (!updated) {
    return null;
  }

  const before = snapshotSite(existing);
  const after = snapshotSite(updated);

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "site",
    resourceId: siteId,
    action: "update",
    payload: {
      before,
      after,
      changes: buildChanges(before, after, ["regionId"]),
      summary: regionId
        ? `Región asignada a ${updated.name}`
        : `Región quitada a ${updated.name}`,
    },
  });

  return updated;
};
