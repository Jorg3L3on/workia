import { cookies } from "next/headers";

import { env } from "@/env";
import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

export const clearLogoutLatchOnServer = async () => {
  const cookieStore = await cookies();
  const secure = env.NODE_ENV === "production";

  cookieStore.set({
    name: LOGOUT_LATCH_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure,
  });
};
