import { describe, expect, it, vi } from "vitest";

import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

const deleteCookie = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: deleteCookie,
  }),
}));

import { clearLogoutLatchOnServer } from "@/lib/auth/logout-latch-server";

describe("clearLogoutLatchOnServer", () => {
  it("deletes the logout latch cookie on Path=/", async () => {
    await clearLogoutLatchOnServer();

    expect(deleteCookie).toHaveBeenCalledWith({
      name: LOGOUT_LATCH_COOKIE_NAME,
      path: "/",
    });
  });
});
