import { and, eq, isNull } from "drizzle-orm";

import { db, tdb } from "@/lib/db";
import {
  companyMemberships,
  people,
  permissions,
  rolePermissions,
} from "@/lib/db/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { withTenant } from "@/lib/tenant/scope";

/**
 * Who a notification goes to: a person (they read it in the employee app,
 * /mi) or an HR user of the company (they read it in the HR app, /app).
 */
export type NotificationRecipient =
  { kind: "person"; personId: string } | { kind: "user"; userId: string };

export const personRecipient = (personId: string): NotificationRecipient => ({
  kind: "person",
  personId,
});

export const userRecipient = (userId: string): NotificationRecipient => ({
  kind: "user",
  userId,
});

/** A stable key of a recipient, for dedupe keys and logs. */
export const recipientKey = (recipient: NotificationRecipient) =>
  recipient.kind === "person"
    ? `p:${recipient.personId}`
    : `u:${recipient.userId}`;

/**
 * The HR users of a company who hold `permission` there through an active
 * membership: who hears about a contract ending (contracts:update) or a
 * document to review (documents:manage).
 */
export const hrRecipientsWithPermission = async (
  companyId: string,
  permission: PermissionSlug,
): Promise<NotificationRecipient[]> => {
  const rows = await db
    .selectDistinct({ userId: companyMemberships.userId })
    .from(companyMemberships)
    .innerJoin(
      rolePermissions,
      eq(rolePermissions.roleId, companyMemberships.roleId),
    )
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.status, "activa"),
        eq(permissions.slug, permission),
      ),
    );

  return rows.map((row) => userRecipient(row.userId));
};

/**
 * The live manager of a person (people.manager_id) as a recipient, or null
 * when the person has none or the manager is no longer in the company.
 */
export const managerRecipientOf = async (
  companyId: string,
  personId: string,
): Promise<NotificationRecipient | null> => {
  const [row] = await tdb(companyId)
    .select({ managerId: people.managerId })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!row?.managerId) {
    return null;
  }

  const [manager] = await tdb(companyId)
    .select({ id: people.id })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, row.managerId),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  return manager ? personRecipient(manager.id) : null;
};
