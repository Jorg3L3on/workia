import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { env } from "@/env";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-max-age";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  listActiveMemberships,
  pickActiveMembership,
} from "@/lib/tenant/memberships";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: env.NODE_ENV === "production",
      },
    },
  },
  session: {
    strategy: "jwt",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user?.passwordHash) {
          logger.warn(
            { email },
            "Sign-in failed: user not found or no password",
          );
          return null;
        }

        const isValidPassword = await bcrypt.compare(
          password,
          user.passwordHash,
        );

        if (!isValidPassword) {
          logger.warn({ email }, "Sign-in failed: invalid password");
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET,
            // A member added by email before their first sign-in already has a
            // users row; Google verifies the address, so link it to that row.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      if (user?.id) {
        token.sub = user.id;
        // Land in the default company (or the only one). Without any, the
        // app sends the user to the "no company" screen.
        token.activeCompanyId =
          pickActiveMembership(await listActiveMemberships(user.id))
            ?.companyId ?? null;
      }

      // switchCompany: accept the new company only if the user belongs to it.
      const requested = (session as { activeCompanyId?: unknown } | undefined)
        ?.activeCompanyId;

      if (trigger === "update" && typeof requested === "string" && token.sub) {
        const memberships = await listActiveMemberships(token.sub);

        if (
          memberships.some((membership) => membership.companyId === requested)
        ) {
          token.activeCompanyId = requested;
        }
      }

      return token;
    },
    session: ({ session, token }) => {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      session.activeCompanyId =
        typeof token.activeCompanyId === "string"
          ? token.activeCompanyId
          : null;

      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
