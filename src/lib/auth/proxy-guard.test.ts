import { describe, expect, it } from "vitest";

import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";
import {
  PROXY_MATCHER,
  isAuthSessionPath,
  requestHasLogoutLatch,
  resolveAuthRouting,
  resolveLatchedProxyResponse,
} from "@/lib/auth/proxy-guard";

const origin = "https://workia.local";

describe("proxy guard", () => {
  it("includes login, app, admin, and session paths in the matcher", () => {
    expect(PROXY_MATCHER).toEqual([
      "/admin/:path*",
      "/app/:path*",
      "/login",
      "/api/auth/session",
      "/api/auth/session/",
    ]);
  });

  it("recognizes Auth.js session paths", () => {
    expect(isAuthSessionPath("/api/auth/session")).toBe(true);
    expect(isAuthSessionPath("/api/auth/session/")).toBe(true);
    expect(isAuthSessionPath("/api/auth/signin")).toBe(false);
  });

  it("keeps the logged-in /login → /app bounce when there is no latch", () => {
    const response = resolveAuthRouting({
      pathname: "/login",
      nextUrl: new URL("/login", origin),
      isLoggedIn: true,
    });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(`${origin}/app`);
  });

  it("does not send /login to /app when the logout latch is set", () => {
    const response = resolveLatchedProxyResponse({
      nextUrl: new URL("/login", origin),
    });

    expect(response).toBeUndefined();
  });

  it("sends /app and /admin to /login when the logout latch is set", () => {
    const appResponse = resolveLatchedProxyResponse({
      nextUrl: new URL("/app", origin),
    });
    const adminResponse = resolveLatchedProxyResponse({
      nextUrl: new URL("/admin/rbac", origin),
    });

    expect(appResponse?.status).toBe(307);
    expect(appResponse?.headers.get("location")).toBe(
      `${origin}/login?callbackUrl=%2Fapp`,
    );
    expect(adminResponse?.headers.get("location")).toBe(
      `${origin}/login?callbackUrl=%2Fadmin%2Frbac`,
    );
  });

  it("returns an empty Auth.js session when the logout latch is set", async () => {
    const sessionResponse = resolveLatchedProxyResponse({
      nextUrl: new URL("/api/auth/session", origin),
    });
    const trailingResponse = resolveLatchedProxyResponse({
      nextUrl: new URL("/api/auth/session/", origin),
    });

    expect(sessionResponse?.status).toBe(200);
    expect(sessionResponse?.headers.get("content-type")).toBe(
      "application/json",
    );
    await expect(sessionResponse?.text()).resolves.toBe("null");
    await expect(trailingResponse?.text()).resolves.toBe("null");
  });

  it("reads the latch from the Cookie header", () => {
    const latched = {
      headers: new Headers({
        cookie: `__Secure-authjs.session-token=jwt; ${LOGOUT_LATCH_COOKIE_NAME}=1`,
      }),
    };
    const unlatched = {
      headers: new Headers({
        cookie: "__Secure-authjs.session-token=jwt",
      }),
    };

    expect(requestHasLogoutLatch(latched)).toBe(true);
    expect(requestHasLogoutLatch(unlatched)).toBe(false);
  });
});
