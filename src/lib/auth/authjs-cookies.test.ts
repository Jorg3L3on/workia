import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  getTombstoneAuthCookieNames,
  stripTombstoneAuthCookies,
} from "@/lib/auth/authjs-cookies";

const makeRequest = (cookie?: string) => {
  const headers = new Headers();

  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest(new URL("https://workia.local/login"), { headers });
};

describe("authjs-cookies", () => {
  it("detects tombstone Auth.js cookies", () => {
    expect(
      getTombstoneAuthCookieNames(
        makeRequest("__Secure-authjs.callback-url=deleted"),
      ),
    ).toEqual(["__Secure-authjs.callback-url"]);
  });

  it("strips tombstone Auth.js cookies from the Cookie header", () => {
    expect(
      stripTombstoneAuthCookies(
        "__Secure-authjs.callback-url=deleted; __Secure-authjs.session-token=live-jwt; theme=dark",
      ),
    ).toBe("__Secure-authjs.session-token=live-jwt; theme=dark");
  });

  it("returns null when every cookie was a tombstone", () => {
    expect(
      stripTombstoneAuthCookies(
        "authjs.callback-url=deleted; __Secure-authjs.session-token=deleted",
      ),
    ).toBeNull();
  });
});
