import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import { authConfig } from "@/auth.config";
import { env } from "@/env";
import { db } from "@/lib/db";
import {
  accounts,
  roles,
  sessions,
  userRoles,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";

const assignDefaultRole = async (userId: string) => {
  const [existingRole] = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);

  if (existingRole) {
    return;
  }

  const [viewerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, "viewer"))
    .limit(1);

  if (!viewerRole) {
    return;
  }

  await db
    .insert(userRoles)
    .values({ userId, roleId: viewerRole.id })
    .onConflictDoNothing();
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: env.AUTH_SECRET,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  events: {
    createUser: async ({ user }) => {
      if (!user.id) {
        return;
      }

      await assignDefaultRole(user.id);
      logger.info(
        { userId: user.id },
        "Assigned default viewer role to new user",
      );
    },
    signIn: async ({ user, account }) => {
      if (user.id) {
        await assignDefaultRole(user.id);
      }

      logger.info(
        { userId: user.id, provider: account?.provider },
        "User signed in",
      );
    },
  },
});
