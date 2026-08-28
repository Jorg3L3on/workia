export type AuthCookieClearSpec = {
  name: string;
  secure: boolean;
};

const EXPIRES_EPOCH = new Date(0);

const AUTH_COOKIE_NAME_PATTERN =
  /^(?:__Secure-|__Host-)?(?:authjs|next-auth)\./;

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

export const serializeExpiredAuthCookie = (
  name: string,
  secure: boolean,
): string => {
  const parts = [
    `${name}=`,
    "Path=/",
    `Expires=${EXPIRES_EPOCH.toUTCString()}`,
    "Max-Age=0",
    "HttpOnly",
  ];

  if (secure) {
    parts.push("Secure");
  }

  parts.push("SameSite=Lax");

  return parts.join("; ");
};

export const appendExpiredAuthCookies = (
  headers: Headers,
  specs: AuthCookieClearSpec[],
) => {
  for (const spec of specs) {
    headers.append(
      "Set-Cookie",
      serializeExpiredAuthCookie(spec.name, spec.secure),
    );
  }
};
