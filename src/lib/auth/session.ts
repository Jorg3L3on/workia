import { cache } from "react";

import { auth } from "@/auth";

// Per-request: layout, page and guards all read the session.
export const getSession = cache(async () => auth());

export const getCurrentUserId = async (): Promise<string | null> => {
  const session = await getSession();
  return session?.user?.id ?? null;
};

export const requireAuth = async () => {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  return session;
};
