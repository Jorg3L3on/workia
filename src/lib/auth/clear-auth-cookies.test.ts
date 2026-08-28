import { describe, expect, it } from "vitest";

import {
  AUTH_COOKIE_TOMBSTONE_VALUE,
  collectAuthCookiesToClear,
  isAuthCookieName,
  serializeTombstoneAuthCookie,
} from "@/lib/auth/clear-auth-cookies";

describe("clear-auth-cookies", () => {
  it("serializes tombstone __Secure-authjs.session-token matching Auth.js login identity", () => {
    const header = serializeTombstoneAuthCookie(
      "__Secure-authjs.session-token",
      true,
    );

    expect(header).toBe(
      "__Secure-authjs.session-token=deleted; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(header).toContain(`=${AUTH_COOKIE_TOMBSTONE_VALUE}`);
    expect(header).not.toContain("Max-Age=0");
    expect(header).not.toMatch(/=;/);
  });

  it("serializes tombstone __Host-authjs.csrf-token with Secure", () => {
    const header = serializeTombstoneAuthCookie(
      "__Host-authjs.csrf-token",
      true,
    );

    expect(header).toBe(
      "__Host-authjs.csrf-token=deleted; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("does not add Secure to non-secure cookie serialization", () => {
    const header = serializeTombstoneAuthCookie("authjs.session-token", false);

    expect(header).toBe(
      "authjs.session-token=deleted; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(header).not.toContain("Secure");
  });

  it("recognizes authjs and next-auth cookie names", () => {
    expect(isAuthCookieName("__Secure-authjs.session-token")).toBe(true);
    expect(isAuthCookieName("__Host-authjs.csrf-token")).toBe(true);
    expect(isAuthCookieName("next-auth.session-token")).toBe(true);
    expect(isAuthCookieName("theme")).toBe(false);
  });

  it("collects request cookies plus known Auth.js names without speculative extras", () => {
    const request = new Request("https://workia.local/logout", {
      method: "POST",
      headers: {
        cookie:
          "__Secure-authjs.session-token=jwt; __Host-authjs.csrf-token=csrf; theme=dark",
      },
    });

    const specs = collectAuthCookiesToClear(request);
    const names = specs.map((spec) => spec.name).sort();

    expect(names).toEqual([
      "__Host-authjs.csrf-token",
      "__Secure-authjs.callback-url",
      "__Secure-authjs.session-token",
    ]);
    expect(names).not.toContain("theme");
    expect(names.length).toBeLessThanOrEqual(5);
  });
});
