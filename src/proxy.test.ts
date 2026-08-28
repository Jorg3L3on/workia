import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: (
    handler: (request: {
      nextUrl: URL;
      headers: Headers;
      auth?: { user: { id: string } };
    }) => Response | undefined,
  ) => {
    return (request: NextRequest) =>
      handler({
        nextUrl: request.nextUrl,
        headers: request.headers,
        auth: { user: { id: "user-1" } },
      });
  },
}));

import proxy, { config } from "@/proxy";
import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

const routeContext = { params: Promise.resolve({}) };

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
  it("matches login, app, admin, and Auth.js session", () => {
    expect(config.matcher).toEqual([
      "/admin/:path*",
      "/app/:path*",
      "/login",
      "/api/auth/session",
      "/api/auth/session/",
    ]);
  });

  it("lets the logout latch win even when auth() still sees a JWT user", async () => {
    const cookie = `${LOGOUT_LATCH_COOKIE_NAME}=1; __Secure-authjs.session-token=jwt`;

    const loginResponse = await proxy(
      makeRequest("/login", cookie),
      routeContext,
    );
    const appResponse = await proxy(makeRequest("/app", cookie), routeContext);
    const sessionResponse = await proxy(
      makeRequest("/api/auth/session", cookie),
      routeContext,
    );

    expect(loginResponse).toBeUndefined();
    expect(appResponse?.headers.get("location")).toBe(
      "https://workia.local/login?callbackUrl=%2Fapp",
    );
    expect(sessionResponse?.status).toBe(200);
    await expect(sessionResponse?.text()).resolves.toBe("null");
  });

  it("keeps the logged-in /login → /app bounce when there is no latch", async () => {
    const response = await proxy(
      makeRequest("/login", "__Secure-authjs.session-token=jwt"),
      routeContext,
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("https://workia.local/app");
  });
});
