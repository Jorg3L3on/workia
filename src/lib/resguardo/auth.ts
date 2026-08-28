import { requireAuth } from "@/lib/auth/session";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { requirePermission } from "@/lib/rbac";

export const requireAssetsPermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requireAssetsRead = () => requireAssetsPermission("assets:read");
export const requireAssetsCreate = () =>
  requireAssetsPermission("assets:create");
export const requireAssetsUpdate = () =>
  requireAssetsPermission("assets:update");
export const requireAssetsDelete = () =>
  requireAssetsPermission("assets:delete");
