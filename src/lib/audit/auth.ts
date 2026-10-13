import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireCompanyContext } from "@/lib/tenant/context";

export const requireAuditPermission = (permission: PermissionSlug) =>
  // The company context (active company + membership permissions) is the door
  // to business data; callers read `session.companyId` for every query.
  requireCompanyContext(permission);

export const requireAuditRead = async () =>
  requireAuditPermission("audit:read");
