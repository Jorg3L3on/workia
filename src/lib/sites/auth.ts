import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireCompanyContext } from "@/lib/tenant/context";

export const requireSitesPermission = (permission: PermissionSlug) =>
  // The company context (active company + membership permissions) is the door
  // to business data; callers read `session.companyId` for every query.
  requireCompanyContext(permission);

export const requireSitesRead = async () =>
  requireSitesPermission("sites:read");

export const requireSitesCreate = async () =>
  requireSitesPermission("sites:create");

export const requireSitesUpdate = async () =>
  requireSitesPermission("sites:update");

export const requireSitesDelete = async () =>
  requireSitesPermission("sites:delete");
