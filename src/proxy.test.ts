import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizedProxy = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authorizedProxy,
}));

import proxy, { config } from "@/proxy";
import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

const makeRequest = (pathname: string, cookie?: string) => {
  const headers = new Headers();
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest(new URL(pathname, "https://workia.local"), {
    headers,
  });
};

describe("proxy", () => {
  beforeEach(() => {
    authorizedProxy.mockReset();
    authorizedProxy.mockResolvedValue(undefined);
  });

  it("matches login, app, admin, and Auth.js session", () => {
    expect(config.matcher).toEqual([
      "/admin/:path*",
      "/app/:path*",
      "/login",
      "/api/auth/session",
      "/api/auth/session/",
    ]);
  });

  it("does not run auth() when the logout latch is set", async () => {
    const cookie = `${LOGOUT_LATCH_COOKIE_NAME}=1; __Secure-authjs.session-token=jwt`;

    const loginResponse = await proxy(
      makeRequest("/login", cookie),
      {} as never,
    );
    const appResponse = await proxy(makeRequest("/app", cookie), {} as never);
    const sessionResponse = await proxy(
      makeRequest("/api/auth/session", cookie),
      {} as never,
    );

    expect(authorizedProxy).not.toHaveBeenCalled();
    expect(loginResponse).toBeUndefined();
    expect(appResponse?.headers.get("location")).toBe(
      "https://workia.local/login?callbackUrl=%2Fapp",
    );
    expect(sessionResponse?.status).toBe(200);
    await expect(sessionResponse?.text()).resolves.toBe("null");
  });

  it("runs auth() when there is no latch so logged-in /login can bounce to /app", async () => {
    await proxy(
      makeRequest("/login", "__Secure-authjs.session-token=jwt"),
      {} as never,
    );

    expect(authorizedProxy).toHaveBeenCalledOnce();
  });
});
