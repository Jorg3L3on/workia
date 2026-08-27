import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";

export const requirePeoplePermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requirePeopleRead = async () =>
  requirePeoplePermission("people:read");

export const requirePeopleCreate = async () =>
  requirePeoplePermission("people:create");

export const requirePeopleUpdate = async () =>
  requirePeoplePermission("people:update");
