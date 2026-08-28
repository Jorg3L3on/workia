import { describe, expect, it } from "vitest";

import { POST } from "@/app/logout/route";
import { AUTH_COOKIE_TOMBSTONE_VALUE } from "@/lib/auth/clear-auth-cookies";

describe("POST /logout", () => {
  it("returns 200 HTML with no-store cache, tombstone session cookie, and Clear-Site-Data", async () => {
    const formData = new FormData();
    formData.set("redirectTo", "/login");

    const request = new Request("https://workia.local/logout", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
        cookie: "__Secure-authjs.session-token=jwt-value",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("clear-site-data")).toBe('"cookies"');

    const setCookieHeaders = response.headers.getSetCookie();
    expect(setCookieHeaders.length).toBeLessThanOrEqual(5);
    expect(setCookieHeaders.length).toBeGreaterThan(0);

    const sessionHeaders = setCookieHeaders.filter((header) =>
      header.startsWith("__Secure-authjs.session-token="),
    );

    expect(sessionHeaders).toHaveLength(1);
    expect(sessionHeaders[0]).toBe(
      "__Secure-authjs.session-token=deleted; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(sessionHeaders[0]).toContain(
      `__Secure-authjs.session-token=${AUTH_COOKIE_TOMBSTONE_VALUE}`,
    );
    expect(sessionHeaders[0]).not.toContain("jwt-value");
    expect(sessionHeaders[0]).not.toMatch(/=;/);

    const html = await response.text();
    expect(html).toContain('meta http-equiv="refresh"');
    expect(html).toContain('content="1;url=https://workia.local/login"');
    expect(html).toContain("setTimeout");
    expect(html).toContain("window.location.replace");
    expect(html).toContain("https://workia.local/login");
    expect(html).not.toContain("/app");
    expect(html).not.toContain('location.replace("/login")');
  });

  it("rejects cross-origin POST with 403", async () => {
    const formData = new FormData();
    formData.set("redirectTo", "/login");

    const request = new Request("https://workia.local/logout", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://evil.example",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("clear-site-data")).toBeNull();
  });

  it("falls back to /login when redirectTo is unsafe", async () => {
    const formData = new FormData();
    formData.set("redirectTo", "//evil.example");

    const request = new Request("https://workia.local/logout", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
      body: formData,
    });

    const response = await POST(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('content="1;url=https://workia.local/login"');
    expect(html).toContain("setTimeout");
    expect(html).toContain(
      'window.location.replace("https://workia.local/login")',
    );
    expect(html).not.toContain("/app");
  });

  it("ignores redirectTo=/app and never navigates to /app", async () => {
    const formData = new FormData();
    formData.set("redirectTo", "/app");

    const request = new Request("https://workia.local/logout", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
      body: formData,
    });

    const response = await POST(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("https://workia.local/login");
    expect(html).not.toContain("/app");
    expect(html).not.toContain("https://workia.local/app");
  });
});
