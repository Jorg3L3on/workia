import { auth } from "@/auth";
import { userHasAnyPermission } from "@/lib/rbac";
import type { PermissionSlug } from "@/lib/db/schema/types";

const ADMIN_PERMISSIONS: PermissionSlug[] = [
  "roles:read",
  "users:read",
  "settings:read",
];

export const getSession = async () => auth();

export const getCurrentUserId = async (): Promise<string | null> => {
  const session = await getSession();
  return session?.user?.id ?? null;
};

export const requireAuth = async () => {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  return session;
};

export const requireAdminAccess = async () => {
  const session = await requireAuth();
  const hasAdminAccess = await userHasAnyPermission(
    session.user.id,
    ADMIN_PERMISSIONS,
  );

  if (!hasAdminAccess) {
    throw new Error("Forbidden");
  }

  return session;
};
