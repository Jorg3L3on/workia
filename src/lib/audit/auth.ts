import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";

export const requireAuditPermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requireAuditRead = async () =>
  requireAuditPermission("audit:read");
