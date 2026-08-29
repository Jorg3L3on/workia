import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

import { signOut } from "@/auth";
import { POST } from "@/app/logout/route";
import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-max-age";

describe("POST /logout", () => {
  beforeEach(() => {
    vi.mocked(signOut).mockClear();
  });

  it("calls Auth.js signOut and returns 200 HTML with no-store cache and logout latch", async () => {
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

    expect(signOut).toHaveBeenCalledWith({
      redirect: false,
      redirectTo: "/login",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("clear-site-data")).toBeNull();

    const setCookieHeaders = response.headers.getSetCookie();
    expect(setCookieHeaders).toHaveLength(1);
    expect(setCookieHeaders[0]).toBe(
      `${LOGOUT_LATCH_COOKIE_NAME}=1; Path=/; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}; SameSite=Lax; Secure`,
    );

    const html = await response.text();
    expect(html).toContain('meta http-equiv="refresh"');
    expect(html).toContain('content="1;url=https://workia.local/login"');
    expect(html).toContain("setTimeout");
    expect(html).toContain("window.location.replace");
    expect(html).toContain("https://workia.local/login");
    expect(html).toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
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
