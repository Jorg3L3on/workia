import { and, asc, count, eq, isNull } from "drizzle-orm";

import { buildChanges, recordAuditEvent, snapshotRegion } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import { rethrowDuplicate } from "@/lib/db/errors";
import { regions, sites } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import type { RegionFormValues } from "./schema";

/**
 * Regions over sites (WRK-I5-4): a company catalog with logical delete. They
 * use the sites:* permissions, as the sites they group.
 */
export const listRegions = async (
  companyId: string,
  options: { activeOnly?: boolean } = {},
) =>
  tdb(companyId)
    .select()
    .from(regions)
    .where(
      withTenant(
        regions,
        companyId,
        isNull(regions.deletedAt),
        options.activeOnly ? eq(regions.active, true) : undefined,
      ),
    )
    .orderBy(asc(regions.name));

/** Regions with how many active sites each one groups. */
export const listRegionsWithSiteCounts = async (companyId: string) => {
  const [rows, counts] = await Promise.all([
    listRegions(companyId),
    tdb(companyId)
      .select({ regionId: sites.regionId, sites: count() })
      .from(sites)
      .where(withTenant(sites, companyId, isNull(sites.deletedAt)))
      .groupBy(sites.regionId),
  ]);
  const bySite = new Map(counts.map((row) => [row.regionId, row.sites]));

  return rows.map((region) => ({
    ...region,
    siteCount: bySite.get(region.id) ?? 0,
  }));
};

export const getRegionById = async (companyId: string, id: string) => {
  const [region] = await tdb(companyId)
    .select()
    .from(regions)
    .where(withTenant(regions, companyId, eq(regions.id, id)))
    .limit(1);
  return region ?? null;
};

const DUPLICATE = "Ya existe una región activa con ese nombre.";

export const createRegion = async (
  companyId: string,
  input: RegionFormValues,
  actorUserId?: string | null,
) => {
  const [created] = await tdb(companyId)
    .insert(regions)
    .values({ companyId, name: input.name, active: input.active })
    .returning()
    .catch(rethrowDuplicate(DUPLICATE));

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "region",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotRegion(created),
      summary: `Región creada: ${created.name}`,
    },
  });

  return created;
};

export const updateRegion = async (
  companyId: string,
  id: string,
  input: RegionFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getRegionById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const [updated] = await tdb(companyId)
    .update(regions)
    .set({ name: input.name, active: input.active })
    .where(withTenant(regions, companyId, eq(regions.id, id)))
    .returning()
    .catch(rethrowDuplicate(DUPLICATE));

  if (!updated) {
    return null;
  }

  const before = snapshotRegion(existing);
  const after = snapshotRegion(updated);

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "region",
    resourceId: id,
    action: "update",
    payload: {
      before,
      after,
      changes: buildChanges(before, after, ["name", "active"]),
      summary: `Región editada: ${updated.name}`,
    },
  });

  return updated;
};

/** Logical delete; its sites are left without a region, in the same transaction. */
export const softDeleteRegion = async (
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getRegionById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  return withTransaction(async (tx) => {
    const released = await tx
      .update(sites)
      .set({ regionId: null })
      .where(withTenant(sites, companyId, eq(sites.regionId, id)))
      .returning({ id: sites.id });
    const [updated] = await tx
      .update(regions)
      .set({ deletedAt: new Date() })
      .where(
        withTenant(
          regions,
          companyId,
          and(eq(regions.id, id), isNull(regions.deletedAt)),
        ),
      )
      .returning();

    if (!updated) {
      return null;
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "region",
        resourceId: id,
        action: "delete",
        payload: {
          before: snapshotRegion(existing),
          after: snapshotRegion(updated),
          summary: `Región borrada lógicamente: ${existing.name}${released.length > 0 ? ` (${released.length} sucursal${released.length === 1 ? "" : "es"} sin región)` : ""}`,
        },
      },
      tx,
    );

    return updated;
  }, companyId);
};
