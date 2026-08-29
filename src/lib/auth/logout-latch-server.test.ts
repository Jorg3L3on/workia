import { describe, expect, it, vi } from "vitest";

import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

const setCookie = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: setCookie,
  }),
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "production",
  },
}));

import { clearLogoutLatchOnServer } from "@/lib/auth/logout-latch-server";

describe("clearLogoutLatchOnServer", () => {
  it("expires the logout latch cookie on Path=/ with Secure in production", async () => {
    await clearLogoutLatchOnServer();

    expect(setCookie).toHaveBeenCalledWith({
      name: LOGOUT_LATCH_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: true,
    });
  });
});
