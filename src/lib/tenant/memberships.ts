import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companies,
  companyMemberships,
  permissions,
  rolePermissions,
  roles,
  users,
} from "@/lib/db/schema";
import {
  PLATFORM_PERMISSIONS,
  type PermissionSlug,
} from "@/lib/db/schema/types";

export type ActiveMembership = {
  membershipId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  roleId: string;
  roleSlug: string;
  roleName: string;
  isDefault: boolean;
};

/**
 * Memberships that grant access right now: the membership is active and its
 * company is active and not deleted. Read on every request, so a revocation or
 * a suspension applies on the next one.
 */
export const listActiveMemberships = async (
  userId: string,
): Promise<ActiveMembership[]> =>
  db
    .select({
      membershipId: companyMemberships.id,
      companyId: companies.id,
      companyName: companies.name,
      companySlug: companies.slug,
      roleId: roles.id,
      roleSlug: roles.slug,
      roleName: roles.name,
      isDefault: companyMemberships.isDefault,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .where(
      and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.status, "activa"),
        eq(companies.status, "activa"),
        isNull(companies.deletedAt),
      ),
    )
    .orderBy(asc(companies.name));

/**
 * The membership a request acts in: the company the session chose if the user
 * still belongs to it, else their default company, else their only company.
 * Null when there is nothing to pick (none, or several and no default).
 */
export const pickActiveMembership = (
  memberships: ActiveMembership[],
  requestedCompanyId?: string | null,
): ActiveMembership | null => {
  if (requestedCompanyId) {
    const requested = memberships.find(
      (membership) => membership.companyId === requestedCompanyId,
    );

    if (requested) {
      return requested;
    }
  }

  return (
    memberships.find((membership) => membership.isDefault) ??
    (memberships.length === 1 ? memberships[0] : null)
  );
};

export const getRolePermissionSlugs = async (
  roleId: string,
): Promise<PermissionSlug[]> => {
  const rows = await db
    .select({ slug: permissions.slug })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));

  return rows.map((row) => row.slug as PermissionSlug);
};

export const isPlatformAdmin = async (userId: string) => {
  const [row] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.isPlatformAdmin ?? false;
};

/**
 * Effective permissions: the role's permissions in the active company (never
 * platform ones, whatever the role holds) plus the platform permissions of a
 * platform admin.
 */
export const combinePermissions = (
  rolePermissionSlugs: PermissionSlug[],
  platformAdmin: boolean,
): Set<PermissionSlug> => {
  const platform = new Set<PermissionSlug>(PLATFORM_PERMISSIONS);
  const combined = new Set(
    rolePermissionSlugs.filter((slug) => !platform.has(slug)),
  );

  if (platformAdmin) {
    for (const slug of platform) {
      combined.add(slug);
    }
  }

  return combined;
};

export const getRoleIdsBySlug = async (slugs: string[]) => {
  if (slugs.length === 0) {
    return new Map<string, string>();
  }

  const rows = await db
    .select({ id: roles.id, slug: roles.slug })
    .from(roles)
    .where(inArray(roles.slug, slugs));

  return new Map(rows.map((row) => [row.slug, row.id]));
};
