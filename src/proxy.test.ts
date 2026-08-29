import { readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy, { config, requestHasAuthjsSessionCookie } from "@/proxy";

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
  it("does not import or call auth()", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/proxy.ts"),
      "utf8",
    );

    expect(source).not.toContain('from "@/auth"');
    expect(source).not.toContain("from '@/auth'");
    expect(source).not.toMatch(/\bauth\s*\(/);
  });

  it("matches app, admin, login, and auth routes with a static matcher literal", () => {
    expect(config.matcher).toEqual([
      "/admin/:path*",
      "/app/:path*",
      "/login",
      "/api/auth/:path*",
    ]);

    const source = readFileSync(
      path.join(process.cwd(), "src/proxy.ts"),
      "utf8",
    );
    expect(source).toContain('"/login"');
    expect(source).toContain('"/api/auth/:path*"');
  });

  it("does not bounce /login to /app when a session cookie is present", () => {
    const response = proxy(
      makeRequest("/login", "__Secure-authjs.session-token=jwt"),
    );

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends /app without a session cookie to /login", () => {
    const response = proxy(makeRequest("/app"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workia.local/login?callbackUrl=%2Fapp",
    );
  });

  it("sends /admin without a session cookie to /login", () => {
    const response = proxy(makeRequest("/admin/rbac"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workia.local/login?callbackUrl=%2Fadmin%2Frbac",
    );
  });

  it("lets /app through when a live Auth.js session cookie is present", () => {
    const response = proxy(makeRequest("/app", "authjs.session-token=jwt"));

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get("location")).toBeNull();
  });

  it("treats empty and literal deleted session cookies as logged out", () => {
    expect(
      requestHasAuthjsSessionCookie(
        makeRequest("/app", "__Secure-authjs.session-token="),
      ),
    ).toBe(false);
    expect(
      requestHasAuthjsSessionCookie(
        makeRequest("/app", "__Secure-authjs.session-token=deleted"),
      ),
    ).toBe(false);
    expect(
      requestHasAuthjsSessionCookie(
        makeRequest("/app", "authjs.session-token=live-jwt"),
      ),
    ).toBe(true);
  });

  it("sends /app to /login when the session cookie is a leftover deleted value", () => {
    const response = proxy(
      makeRequest("/app", "__Secure-authjs.session-token=deleted"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workia.local/login?callbackUrl=%2Fapp",
    );
  });

  it("expires tombstone Auth.js cookies on /login", () => {
    const response = proxy(
      makeRequest("/login", "__Secure-authjs.callback-url=deleted"),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get("__Secure-authjs.callback-url")?.value).toBe(
      "",
    );
  });

  it("sanitizes tombstone Auth.js cookies before /api/auth handlers run", () => {
    const response = proxy(
      makeRequest(
        "/api/auth/session",
        "__Secure-authjs.callback-url=deleted; __Secure-authjs.session-token=live-jwt",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "__Secure-authjs.session-token=live-jwt",
    );
    expect(response.cookies.get("__Secure-authjs.callback-url")?.value).toBe(
      "",
    );
  });
});
