import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import type { PermissionSlug } from "@/lib/db/schema/types";

export const requireContractsPermission = async (
  permission: PermissionSlug,
) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requireContractsRead = () =>
  requireContractsPermission("contracts:read");

export const requireContractsCreate = () =>
  requireContractsPermission("contracts:create");

export const requireContractsUpdate = () =>
  requireContractsPermission("contracts:update");

export const requireContractsDelete = () =>
  requireContractsPermission("contracts:delete");

export const requireContractTemplatesRead = () =>
  requireContractsPermission("contract_templates:read");

export const requireContractTemplatesCreate = () =>
  requireContractsPermission("contract_templates:create");

export const requireContractTemplatesUpdate = () =>
  requireContractsPermission("contract_templates:update");

export const requireContractTemplatesDelete = () =>
  requireContractsPermission("contract_templates:delete");
