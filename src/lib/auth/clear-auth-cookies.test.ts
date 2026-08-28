import { describe, expect, it } from "vitest";

import {
  collectAuthCookiesToClear,
  isAuthCookieName,
  serializeExpiredAuthCookie,
} from "@/lib/auth/clear-auth-cookies";

describe("clear-auth-cookies", () => {
  it("serializes expired __Secure-authjs.session-token matching Auth.js attribute order", () => {
    const header = serializeExpiredAuthCookie(
      "__Secure-authjs.session-token",
      true,
    );

    expect(header).toBe(
      "__Secure-authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("does not add Secure to non-secure cookie serialization", () => {
    const header = serializeExpiredAuthCookie("authjs.session-token", false);

    expect(header).toBe(
      "authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax",
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
