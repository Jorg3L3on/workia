import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    /** Company the user chose to act in; validated against their memberships on every request. */
    activeCompanyId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;
    activeCompanyId?: string | null;
  }
}
