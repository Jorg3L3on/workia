import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import { authConfig } from "@/auth.config";
import { env } from "@/env";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  secret: env.AUTH_SECRET,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  events: {
    // New users get no access: a company admin or the platform adds them to a
    // company (WRK-I4). Until then they see "No perteneces a ninguna empresa".
    signIn: async ({ user, account }) => {
      logger.info(
        { userId: user.id, provider: account?.provider },
        "User signed in",
      );
    },
  },
});
