import type { NextRequest, NextResponse } from "next/server";

export const AUTHJS_COOKIE_TOMBSTONE_VALUE = "deleted";

const AUTHJS_COOKIE_PREFIXES = [
  "authjs.",
  "__Secure-authjs.",
  "__Host-authjs.",
] as const;

const isAuthjsCookieName = (name: string) =>
  AUTHJS_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix));

export const getTombstoneAuthCookieNames = (request: NextRequest) =>
  request.cookies
    .getAll()
    .filter(
      (cookie) =>
        isAuthjsCookieName(cookie.name) &&
        cookie.value === AUTHJS_COOKIE_TOMBSTONE_VALUE,
    )
    .map((cookie) => cookie.name);

export const stripTombstoneAuthCookies = (cookieHeader: string | null) => {
  if (!cookieHeader) {
    return null;
  }

  const kept = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        return true;
      }

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      return !(
        isAuthjsCookieName(name) && value === AUTHJS_COOKIE_TOMBSTONE_VALUE
      );
    });

  if (kept.length === 0) {
    return null;
  }

  return kept.join("; ");
};

export const buildRequestHeadersWithoutTombstones = (request: NextRequest) => {
  const requestHeaders = new Headers(request.headers);
  const cleanedCookieHeader = stripTombstoneAuthCookies(
    request.headers.get("cookie"),
  );

  if (cleanedCookieHeader) {
    requestHeaders.set("cookie", cleanedCookieHeader);
  } else {
    requestHeaders.delete("cookie");
  }

  return requestHeaders;
};

export const expireAuthCookies = (
  response: NextResponse,
  cookieNames: string[],
) => {
  for (const name of cookieNames) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      secure: name.startsWith("__Secure-") || name.startsWith("__Host-"),
    });
  }
};

export const finalizeAuthProxyResponse = (
  request: NextRequest,
  response: NextResponse,
) => {
  const tombstoneNames = getTombstoneAuthCookieNames(request);

  if (tombstoneNames.length === 0) {
    return response;
  }

  expireAuthCookies(response, tombstoneNames);
  return response;
};
