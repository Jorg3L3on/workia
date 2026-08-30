import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";

export const requireCatalogPermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requireAreasRead = async () =>
  requireCatalogPermission("areas:read");

export const requireAreasCreate = async () =>
  requireCatalogPermission("areas:create");

export const requireAreasUpdate = async () =>
  requireCatalogPermission("areas:update");

export const requireAreasDelete = async () =>
  requireCatalogPermission("areas:delete");

export const requirePositionsRead = async () =>
  requireCatalogPermission("positions:read");

export const requirePositionsCreate = async () =>
  requireCatalogPermission("positions:create");

export const requirePositionsUpdate = async () =>
  requireCatalogPermission("positions:update");

export const requirePositionsDelete = async () =>
  requireCatalogPermission("positions:delete");

/** Activities reuse positions:* — they describe what a puesto does. */
export const requireActivitiesRead = async () => requirePositionsRead();

export const requireActivitiesCreate = async () => requirePositionsCreate();

export const requireActivitiesUpdate = async () => requirePositionsUpdate();

export const requireActivitiesDelete = async () => requirePositionsDelete();
