import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * The group admin grant (W2-24): users.is_group_admin, a platform flag like
 * is_platform_admin. It lets a user read a person's linked rows in every
 * company of the group (the group timeline), each read under that company's
 * row-level security. It grants no write and no company membership.
 */

export const listGroupAdmins = async () =>
  db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.isGroupAdmin, true))
    .orderBy(asc(users.name));

/** Gives or takes the grant by email; false when no user has that email. */
export const setGroupAdmin = async (email: string, grant: boolean) => {
  const normalized = email.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const updated = await db
    .update(users)
    .set({ isGroupAdmin: grant })
    .where(sql`lower(${users.email}) = ${normalized}`)
    .returning({ id: users.id });

  return updated.length > 0;
};
