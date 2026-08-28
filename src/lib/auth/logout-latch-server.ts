import { cookies } from "next/headers";

import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

export const clearLogoutLatchOnServer = async () => {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: LOGOUT_LATCH_COOKIE_NAME,
    path: "/",
  });
};
