import { describe, expect, it } from "vitest";

import { POST } from "@/app/logout/route";

describe("POST /logout", () => {
  it("returns 200 HTML with no-store cache and expires secure session cookies", async () => {
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

    const setCookieHeaders = response.headers.getSetCookie();
    expect(setCookieHeaders.length).toBeLessThanOrEqual(5);
    expect(setCookieHeaders.length).toBeGreaterThan(0);

    const sessionHeader = setCookieHeaders.find((header) =>
      header.startsWith("__Secure-authjs.session-token="),
    );

    expect(sessionHeader).toBe(
      "__Secure-authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
    expect(
      setCookieHeaders.some(
        (header) =>
          header.startsWith("__Secure-authjs.session-token=") &&
          !header.includes("jwt-value"),
      ),
    ).toBe(true);

    const html = await response.text();
    expect(html).toContain('meta http-equiv="refresh"');
    expect(html).toContain("location.replace");
    expect(html).toContain("/login");
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
  });

  it("falls back to / when redirectTo is unsafe", async () => {
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
    expect(html).toContain('content="0;url=/"');
    expect(html).toContain('location.replace("/")');
  });
});
