import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

import {
  applyAuthCookieClearing,
  applyAuthCookieClearSpec,
  AUTH_COOKIE_CLEAR_SPECS,
  serializeExpiredAuthCookie,
} from "@/lib/auth/clear-auth-cookies";

describe("clear-auth-cookies", () => {
  it("includes __Secure-authjs.session-token with secure flag", () => {
    const spec = AUTH_COOKIE_CLEAR_SPECS.find(
      (entry) => entry.name === "__Secure-authjs.session-token",
    );

    expect(spec).toEqual({
      name: "__Secure-authjs.session-token",
      secure: true,
    });
  });

  it("includes chunked __Secure-authjs.session-token variants", () => {
    expect(
      AUTH_COOKIE_CLEAR_SPECS.some(
        (entry) => entry.name === "__Secure-authjs.session-token.0",
      ),
    ).toBe(true);
    expect(
      AUTH_COOKIE_CLEAR_SPECS.some(
        (entry) => entry.name === "__Secure-authjs.session-token.1",
      ),
    ).toBe(true);
  });

  it("includes non-secure localhost session cookie names", () => {
    const spec = AUTH_COOKIE_CLEAR_SPECS.find(
      (entry) => entry.name === "authjs.session-token",
    );

    expect(spec).toEqual({
      name: "authjs.session-token",
      secure: false,
    });
  });

  it("serializes expired __Secure-authjs.session-token with Secure and Max-Age=0", () => {
    const header = serializeExpiredAuthCookie(
      "__Secure-authjs.session-token",
      true,
    );

    expect(header).toContain("__Secure-authjs.session-token=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("does not add Secure to non-secure cookie serialization", () => {
    const header = serializeExpiredAuthCookie("authjs.session-token", false);

    expect(header).toContain("authjs.session-token=");
    expect(header).not.toContain("Secure");
  });

  it("applyAuthCookieClearSpec expires __Secure-authjs.session-token on NextResponse", () => {
    const response = NextResponse.redirect("https://workia.local/");
    applyAuthCookieClearSpec(response, {
      name: "__Secure-authjs.session-token",
      secure: true,
    });

    const cookie = response.cookies
      .getAll()
      .find((entry) => entry.name === "__Secure-authjs.session-token");

    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("applyAuthCookieClearing expires all known Auth.js cookie names", () => {
    const response = NextResponse.redirect("https://workia.local/");
    applyAuthCookieClearing(response);

    const clearedNames = response.cookies.getAll().map((entry) => entry.name);

    expect(clearedNames).toEqual(
      expect.arrayContaining([
        "__Secure-authjs.session-token",
        "__Secure-authjs.session-token.0",
        "authjs.session-token",
        "__Host-authjs.csrf-token",
      ]),
    );
    expect(clearedNames.length).toBe(AUTH_COOKIE_CLEAR_SPECS.length);
  });
});
