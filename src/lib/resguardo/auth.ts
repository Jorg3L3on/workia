import { requireCompanyContext } from "@/lib/tenant/context";
import type { PermissionSlug } from "@/lib/db/schema/types";

export const requireAssetsPermission = (permission: PermissionSlug) =>
  // The company context (active company + membership permissions) is the door
  // to business data; callers read `session.companyId` for every query.
  requireCompanyContext(permission);

export const requireAssetsRead = () => requireAssetsPermission("assets:read");
export const requireAssetsCreate = () =>
  requireAssetsPermission("assets:create");
export const requireAssetsUpdate = () =>
  requireAssetsPermission("assets:update");
export const requireAssetsDelete = () =>
  requireAssetsPermission("assets:delete");
