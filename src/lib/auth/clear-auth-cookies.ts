import type { NextResponse } from "next/server";

import {
  AUTH_COOKIE_CLEAR_SPECS,
  type AuthCookieClearSpec,
} from "@/lib/auth/auth-cookie-names";

export { AUTH_COOKIE_CLEAR_SPECS };

const EXPIRES_EPOCH = new Date(0);

export const serializeExpiredAuthCookie = (
  name: string,
  secure: boolean,
): string => {
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    `Expires=${EXPIRES_EPOCH.toUTCString()}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
};

export const applyAuthCookieClearSpec = (
  response: NextResponse,
  spec: AuthCookieClearSpec,
) => {
  response.cookies.set(spec.name, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: spec.secure,
    maxAge: 0,
    expires: EXPIRES_EPOCH,
  });
};

export const applyAuthCookieClearing = (response: NextResponse) => {
  for (const spec of AUTH_COOKIE_CLEAR_SPECS) {
    applyAuthCookieClearSpec(response, spec);
  }
};
