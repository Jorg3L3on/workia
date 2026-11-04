import type { PermissionSlug } from "@/lib/db/schema/types";
import {
  getRolePermissionSlugs,
  type ActiveMembership,
} from "@/lib/tenant/memberships";

/**
 * Who may transfer between which companies (W2-24): people:transfer in the
 * company the person leaves (the active one, from requireCompanyContext) and
 * in the company they join, through an active membership there. The group
 * admin grant widens reads only, never writes.
 */
export type TransferTarget = {
  companyId: string;
  companyName: string;
  /** May also invite the new row to the employee app. */
  canManageAccounts: boolean;
};

const TRANSFER: PermissionSlug = "people:transfer";

/** The other companies the actor may transfer a person to, by name. */
export const listTransferTargets = async (session: {
  companyId: string;
  memberships: ActiveMembership[];
}): Promise<TransferTarget[]> => {
  const targets: TransferTarget[] = [];

  for (const membership of session.memberships) {
    if (membership.companyId === session.companyId) continue;

    const slugs = await getRolePermissionSlugs(membership.roleId);

    if (slugs.includes(TRANSFER)) {
      targets.push({
        companyId: membership.companyId,
        companyName: membership.companyName,
        canManageAccounts: slugs.includes("employee_accounts:manage"),
      });
    }
  }

  return targets;
};
