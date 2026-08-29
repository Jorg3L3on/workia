import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-max-age";

export const LOGOUT_LATCH_COOKIE_NAME = "workia-logged-out";
export const LOGOUT_LATCH_COOKIE_VALUE = "1";

const parseCookiePairs = (cookieHeader: string) =>
  cookieHeader.split(";").map((part) => {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return { name: trimmed, value: "" };
    }

    return {
      name: trimmed.slice(0, separatorIndex),
      value: trimmed.slice(separatorIndex + 1),
    };
  });

export const hasLogoutLatch = (cookieHeader: string | null | undefined) => {
  if (!cookieHeader?.trim()) {
    return false;
  }

  return parseCookiePairs(cookieHeader).some(
    (pair) =>
      pair.name === LOGOUT_LATCH_COOKIE_NAME &&
      pair.value === LOGOUT_LATCH_COOKIE_VALUE,
  );
};

export const isHttpsUrl = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

export const shouldUseSecureDocumentCookies = () =>
  typeof window !== "undefined" && window.location.protocol === "https:";

export const serializeLogoutLatchCookie = (secure: boolean) => {
  const parts = [
    `${LOGOUT_LATCH_COOKIE_NAME}=${LOGOUT_LATCH_COOKIE_VALUE}`,
    "Path=/",
    `Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
};

export const serializeClearedLogoutLatchCookie = (secure: boolean) => {
  const parts = [
    `${LOGOUT_LATCH_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
};

export const applyLogoutLatchInDocument = () => {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = serializeLogoutLatchCookie(
    shouldUseSecureDocumentCookies(),
  );
};

export const clearLogoutLatchInDocument = () => {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = serializeClearedLogoutLatchCookie(
    shouldUseSecureDocumentCookies(),
  );
};

export const appendLogoutLatchCookie = (headers: Headers, secure: boolean) => {
  headers.append("Set-Cookie", serializeLogoutLatchCookie(secure));
};

/** Re-applies the latch from the logout HTML page after Clear-Site-Data or stuck JWTs. */
export const buildLogoutLatchInlineScript = (secure: boolean) =>
  `document.cookie=${JSON.stringify(serializeLogoutLatchCookie(secure))};`;
