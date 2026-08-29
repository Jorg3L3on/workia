import { afterEach, describe, expect, it } from "vitest";

import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-max-age";
import {
  LOGOUT_LATCH_COOKIE_NAME,
  LOGOUT_LATCH_COOKIE_VALUE,
  applyLogoutLatchInDocument,
  buildLogoutLatchInlineScript,
  clearLogoutLatchInDocument,
  hasLogoutLatch,
  isHttpsUrl,
  serializeClearedLogoutLatchCookie,
  serializeLogoutLatchCookie,
} from "@/lib/auth/logout-latch";

describe("logout latch", () => {
  afterEach(() => {
    document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
  });

  it("detects the latch cookie in a request Cookie header", () => {
    expect(hasLogoutLatch(null)).toBe(false);
    expect(hasLogoutLatch("")).toBe(false);
    expect(
      hasLogoutLatch(
        `__Secure-authjs.session-token=jwt; ${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}`,
      ),
    ).toBe(true);
    expect(hasLogoutLatch(`${LOGOUT_LATCH_COOKIE_NAME}=0`)).toBe(false);
    expect(hasLogoutLatch("theme=dark")).toBe(false);
  });

  it("serializes a same-origin latch cookie with login persistence", () => {
    expect(serializeLogoutLatchCookie(true)).toBe(
      `${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}; Path=/; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}; SameSite=Lax; Secure`,
    );
    expect(serializeLogoutLatchCookie(false)).toBe(
      `${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}; Path=/; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
    expect(serializeLogoutLatchCookie(true)).not.toContain("HttpOnly");
  });

  it("serializes a cleared latch cookie", () => {
    expect(serializeClearedLogoutLatchCookie(true)).toBe(
      `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure`,
    );
  });

  it("applies and clears the latch on document.cookie", () => {
    applyLogoutLatchInDocument();
    expect(document.cookie).toContain(
      `${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}`,
    );

    clearLogoutLatchInDocument();
    expect(document.cookie).not.toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
  });

  it("builds an inline script that sets the latch cookie", () => {
    expect(buildLogoutLatchInlineScript(true)).toContain(
      `document.cookie="${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}`,
    );
    expect(buildLogoutLatchInlineScript(false)).not.toContain("Secure");
  });

  it("treats https URLs as secure", () => {
    expect(isHttpsUrl("https://workia.local/logout")).toBe(true);
    expect(isHttpsUrl("http://localhost:3000/logout")).toBe(false);
  });
});
