import { forbidden, redirect } from "next/navigation";
import { cache } from "react";

import { getSession, requireAuth } from "@/lib/auth/session";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { AuthorizationError } from "@/lib/rbac/errors";

import {
  combinePermissions,
  getRolePermissionSlugs,
  isPlatformAdmin,
  listActiveMemberships,
  pickActiveMembership,
  type ActiveMembership,
} from "./memberships";

/** The signed-in user has no company to act in (none, or several and none chosen). */
export class NoActiveCompanyError extends AuthorizationError {
  constructor() {
    super("No active company");
    this.name = "NoActiveCompanyError";
  }
}

export type CompanyContext = {
  userId: string;
  companyId: string;
  membership: ActiveMembership;
  memberships: ActiveMembership[];
  permissions: Set<PermissionSlug>;
  isPlatformAdmin: boolean;
};

// Per request: the layout, the page and every guard read it.
const loadAccess = cache(
  async (userId: string, requestedCompanyId: string | null) => {
    const [memberships, platformAdmin] = await Promise.all([
      listActiveMemberships(userId),
      isPlatformAdmin(userId),
    ]);
    const membership = pickActiveMembership(memberships, requestedCompanyId);
    const rolePermissions = membership
      ? await getRolePermissionSlugs(membership.roleId)
      : [];

    return {
      memberships,
      membership,
      platformAdmin,
      permissions: combinePermissions(rolePermissions, platformAdmin),
    };
  },
);

/** Access of `userId`; for the signed-in user it honours the company their session chose. */
export const getUserAccess = async (userId: string) => {
  const session = await getSession();
  const requested =
    session?.user?.id === userId ? (session.activeCompanyId ?? null) : null;

  return loadAccess(userId, requested);
};

/** The company context of this request, or null without a session or an active company. */
export const getCompanyContext = cache(
  async (): Promise<CompanyContext | null> => {
    const session = await getSession();
    const userId = session?.user?.id;

    if (!userId) {
      return null;
    }

    const access = await getUserAccess(userId);

    if (!access.membership) {
      return null;
    }

    return {
      userId,
      companyId: access.membership.companyId,
      membership: access.membership,
      memberships: access.memberships,
      permissions: access.permissions,
      isPlatformAdmin: access.platformAdmin,
    };
  },
);

/**
 * The only door to business data: the signed-in user, the company they act in
 * and, when `permission` is given, proof they hold it there. Every business
 * query takes `companyId` from here.
 */
export const requireCompanyContext = async (permission?: PermissionSlug) => {
  const session = await requireAuth();
  const context = await getCompanyContext();

  if (!context) {
    throw new NoActiveCompanyError();
  }

  if (permission && !context.permissions.has(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }

  // Callers keep reading `session.user`; the company rides along.
  return { ...session, ...context };
};

export type CompanySession = Awaited<ReturnType<typeof requireCompanyContext>>;

/** For pages and layouts: send the user to pick a company instead of failing. */
export const requireCompanyPage = async () => {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const context = await getCompanyContext();

  if (!context) {
    redirect("/empresa");
  }

  return { ...session, ...context };
};

/** Platform console (/admin): platform admins only. */
export const requirePlatformAdmin = async () => {
  const session = await requireAuth();

  if (!(await isPlatformAdmin(session.user.id))) {
    forbidden();
  }

  return session;
};
