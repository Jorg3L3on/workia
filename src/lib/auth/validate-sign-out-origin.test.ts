import { describe, expect, it } from "vitest";

import {
  getSafeSignOutRedirect,
  isSameOriginSignOutRequest,
} from "@/lib/auth/validate-sign-out-origin";

describe("validate-sign-out-origin", () => {
  it("accepts same-origin requests via Origin header", () => {
    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
    });

    expect(isSameOriginSignOutRequest(request)).toBe(true);
  });

  it("accepts same-origin requests via Referer when Origin is missing", () => {
    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        referer: "https://workia.local/app",
      },
    });

    expect(isSameOriginSignOutRequest(request)).toBe(true);
  });

  it("rejects cross-origin requests", () => {
    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://evil.example",
      },
    });

    expect(isSameOriginSignOutRequest(request)).toBe(false);
  });

  it("rejects requests without host", () => {
    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        origin: "https://workia.local",
      },
    });

    expect(isSameOriginSignOutRequest(request)).toBe(false);
  });

  it("returns /login for unsafe redirect targets", () => {
    expect(getSafeSignOutRedirect("//evil.example")).toBe("/login");
    expect(getSafeSignOutRedirect("https://evil.example")).toBe("/login");
    expect(getSafeSignOutRedirect(null)).toBe("/login");
  });

  it("allows only /login or /", () => {
    expect(getSafeSignOutRedirect("/")).toBe("/");
    expect(getSafeSignOutRedirect("/login")).toBe("/login");
  });

  it("rejects /app and other in-app paths", () => {
    expect(getSafeSignOutRedirect("/app")).toBe("/login");
    expect(getSafeSignOutRedirect("/app/personas")).toBe("/login");
    expect(getSafeSignOutRedirect("/login/extra")).toBe("/login");
  });
});
