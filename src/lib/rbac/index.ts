import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import type { PermissionSlug, RoleSlug } from "@/lib/db/schema/types";

import { AuthorizationError } from "./errors";

export { AuthorizationError };

const getUserPermissionSlugs = async (userId: string): Promise<Set<string>> => {
  const rows = await db
    .select({ slug: permissions.slug })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));

  return new Set(rows.map((row) => row.slug));
};

export const getUserPermissions = async (
  userId: string,
): Promise<PermissionSlug[]> => {
  const permissionSlugs = await getUserPermissionSlugs(userId);
  return [...permissionSlugs] as PermissionSlug[];
};

export const userHasPermission = async (
  userId: string,
  permission: PermissionSlug,
): Promise<boolean> => {
  const permissionSlugs = await getUserPermissionSlugs(userId);
  return permissionSlugs.has(permission);
};

export const userHasAnyPermission = async (
  userId: string,
  requiredPermissions: PermissionSlug[],
): Promise<boolean> => {
  if (requiredPermissions.length === 0) {
    return true;
  }

  const permissionSlugs = await getUserPermissionSlugs(userId);
  return requiredPermissions.some((permission) =>
    permissionSlugs.has(permission),
  );
};

export const userHasAllPermissions = async (
  userId: string,
  requiredPermissions: PermissionSlug[],
): Promise<boolean> => {
  if (requiredPermissions.length === 0) {
    return true;
  }

  const permissionSlugs = await getUserPermissionSlugs(userId);
  return requiredPermissions.every((permission) =>
    permissionSlugs.has(permission),
  );
};

export const getUserRoles = async (userId: string): Promise<RoleSlug[]> => {
  const rows = await db
    .select({ slug: roles.slug })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((row) => row.slug as RoleSlug);
};

export const userHasRole = async (
  userId: string,
  roleSlug: RoleSlug,
): Promise<boolean> => {
  const roleSlugs = await getUserRoles(userId);
  return roleSlugs.includes(roleSlug);
};

export const userHasAnyRole = async (
  userId: string,
  roleSlugs: RoleSlug[],
): Promise<boolean> => {
  if (roleSlugs.length === 0) {
    return true;
  }

  const assignedRoles = await getUserRoles(userId);
  return roleSlugs.some((roleSlug) => assignedRoles.includes(roleSlug));
};

export const requirePermission = async (
  userId: string,
  permission: PermissionSlug,
): Promise<void> => {
  const allowed = await userHasPermission(userId, permission);

  if (!allowed) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
};

export const requireAnyPermission = async (
  userId: string,
  requiredPermissions: PermissionSlug[],
): Promise<void> => {
  const allowed = await userHasAnyPermission(userId, requiredPermissions);

  if (!allowed) {
    throw new AuthorizationError(
      `Missing one of permissions: ${requiredPermissions.join(", ")}`,
    );
  }
};

export const requireRole = async (
  userId: string,
  roleSlug: RoleSlug,
): Promise<void> => {
  const allowed = await userHasRole(userId, roleSlug);

  if (!allowed) {
    throw new AuthorizationError(`Missing role: ${roleSlug}`);
  }
};

export const assignRoleToUser = async (
  userId: string,
  roleSlug: RoleSlug,
): Promise<void> => {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, roleSlug))
    .limit(1);

  if (!role) {
    throw new Error(`Role not found: ${roleSlug}`);
  }

  await db
    .insert(userRoles)
    .values({ userId, roleId: role.id })
    .onConflictDoNothing();
};

export const revokeRoleFromUser = async (
  userId: string,
  roleSlug: RoleSlug,
): Promise<void> => {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, roleSlug))
    .limit(1);

  if (!role) {
    throw new Error(`Role not found: ${roleSlug}`);
  }

  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
};

export const getRolePermissionMatrix = async () => {
  const [allRoles, allPermissions, assignments] = await Promise.all([
    db.select().from(roles).orderBy(roles.name),
    db
      .select()
      .from(permissions)
      .orderBy(permissions.resource, permissions.action),
    db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
      })
      .from(rolePermissions),
  ]);

  const assignmentSet = new Set(
    assignments.map(
      (assignment) => `${assignment.roleId}:${assignment.permissionId}`,
    ),
  );

  return {
    roles: allRoles,
    permissions: allPermissions,
    hasPermission: (roleId: string, permissionId: string) =>
      assignmentSet.has(`${roleId}:${permissionId}`),
  };
};

export const getUsersWithRoles = async () => {
  const allUsers = await db.select().from(users).orderBy(users.name);

  if (allUsers.length === 0) {
    return [];
  }

  const assignments = await db
    .select({
      userId: userRoles.userId,
      roleSlug: roles.slug,
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      inArray(
        userRoles.userId,
        allUsers.map((user) => user.id),
      ),
    );

  const rolesByUser = assignments.reduce<Record<string, string[]>>(
    (accumulator, assignment) => {
      if (!accumulator[assignment.userId]) {
        accumulator[assignment.userId] = [];
      }

      accumulator[assignment.userId].push(assignment.roleName);
      return accumulator;
    },
    {},
  );

  return allUsers.map((user) => ({
    ...user,
    roles: rolesByUser[user.id] ?? [],
  }));
};
