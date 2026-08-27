import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";

export const requireSitesPermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requireSitesRead = async () =>
  requireSitesPermission("sites:read");

export const requireSitesCreate = async () =>
  requireSitesPermission("sites:create");

export const requireSitesUpdate = async () =>
  requireSitesPermission("sites:update");

export const requireSitesDelete = async () =>
  requireSitesPermission("sites:delete");
