import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-max-age";

export type AuthCookieClearSpec = {
  name: string;
  secure: boolean;
};

const AUTH_COOKIE_NAME_PATTERN =
  /^(?:__Secure-|__Host-)?(?:authjs|next-auth)\./;

export const AUTH_COOKIE_TOMBSTONE_VALUE = "deleted";

export const KNOWN_AUTH_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "__Host-authjs.csrf-token",
  "__Secure-authjs.callback-url",
] as const;

const isSecureCookieName = (name: string) =>
  name.startsWith("__Secure-") || name.startsWith("__Host-");

const parseCookieHeaderNames = (cookieHeader: string): string[] => {
  if (!cookieHeader.trim()) {
    return [];
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));
};

export const isAuthCookieName = (name: string) =>
  AUTH_COOKIE_NAME_PATTERN.test(name);

export const collectAuthCookiesToClear = (
  request: Request,
): AuthCookieClearSpec[] => {
  const names = new Set<string>(KNOWN_AUTH_COOKIE_NAMES);

  for (const name of parseCookieHeaderNames(
    request.headers.get("cookie") ?? "",
  )) {
    if (isAuthCookieName(name)) {
      names.add(name);
    }
  }

  return [...names].map((name) => ({
    name,
    secure: isSecureCookieName(name),
  }));
};

/** Overwrites an Auth.js cookie with a non-empty tombstone Auth.js cannot parse. */
export const serializeTombstoneAuthCookie = (
  name: string,
  secure: boolean,
): string => {
  const parts = [
    `${name}=${AUTH_COOKIE_TOMBSTONE_VALUE}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  parts.push("SameSite=Lax");

  return parts.join("; ");
};

export const appendTombstoneAuthCookies = (
  headers: Headers,
  specs: AuthCookieClearSpec[],
) => {
  for (const spec of specs) {
    headers.append(
      "Set-Cookie",
      serializeTombstoneAuthCookie(spec.name, spec.secure),
    );
  }
};
