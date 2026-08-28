const CHUNK_SUFFIXES = [".0", ".1", ".2"] as const;

const SESSION_COOKIE_BASE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "__Host-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

const AUXILIARY_COOKIE_BASE_NAMES = [
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "__Secure-authjs.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
] as const;

export type AuthCookieClearSpec = {
  name: string;
  secure: boolean;
};

const isSecureCookieName = (name: string) =>
  name.startsWith("__Secure-") || name.startsWith("__Host-");

const expandCookieNames = (
  baseNames: readonly string[],
): AuthCookieClearSpec[] => {
  const specs: AuthCookieClearSpec[] = [];

  for (const baseName of baseNames) {
    const secure = isSecureCookieName(baseName);
    specs.push({ name: baseName, secure });

    for (const suffix of CHUNK_SUFFIXES) {
      specs.push({ name: `${baseName}${suffix}`, secure });
    }
  }

  return specs;
};

export const AUTH_COOKIE_CLEAR_SPECS: AuthCookieClearSpec[] = [
  ...expandCookieNames(SESSION_COOKIE_BASE_NAMES),
  ...expandCookieNames(AUXILIARY_COOKIE_BASE_NAMES),
];
