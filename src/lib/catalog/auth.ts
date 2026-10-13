import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireCompanyContext } from "@/lib/tenant/context";

export const requireCatalogPermission = (permission: PermissionSlug) =>
  // The company context (active company + membership permissions) is the door
  // to business data; callers read `session.companyId` for every query.
  requireCompanyContext(permission);

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
