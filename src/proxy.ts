import { NextRequest, NextResponse } from "next/server";

import {
  buildRequestHeadersWithoutTombstones,
  finalizeAuthProxyResponse,
  getTombstoneAuthCookieNames,
} from "@/lib/auth/authjs-cookies";

const AUTHJS_SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;

const isLiveSessionCookieValue = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  return value !== "deleted";
};

export const requestHasAuthjsSessionCookie = (request: NextRequest) =>
  AUTHJS_SESSION_COOKIE_NAMES.some((cookieName) =>
    isLiveSessionCookieValue(request.cookies.get(cookieName)?.value),
  );

const isProtectedPath = (pathname: string) =>
  pathname === "/app" ||
  pathname.startsWith("/app/") ||
  pathname === "/admin" ||
  pathname.startsWith("/admin/") ||
  pathname === "/empresa";

// Employee app (W2-01): its own cookie, independent of Auth.js. The proxy only
// checks the cookie is there; requireEmployeeContext() checks the session row.
const EMPLOYEE_SESSION_COOKIE_NAMES = [
  "workia.employee-session",
  "__Host-workia.employee-session",
] as const;

const EMPLOYEE_PUBLIC_PATHS = new Set([
  "/mi/entrar",
  "/mi/activar",
  "/mi/manifest.webmanifest",
  "/mi/sw.js",
]);

export const requestHasEmployeeSessionCookie = (request: NextRequest) =>
  EMPLOYEE_SESSION_COOKIE_NAMES.some((cookieName) =>
    Boolean(request.cookies.get(cookieName)?.value),
  );

const isEmployeeProtectedPath = (pathname: string) =>
  (pathname === "/mi" || pathname.startsWith("/mi/")) &&
  !EMPLOYEE_PUBLIC_PATHS.has(pathname);

const isAuthPath = (pathname: string) =>
  pathname === "/login" || pathname.startsWith("/api/auth/");

const nextWithSanitizedCookies = (request: NextRequest) => {
  if (getTombstoneAuthCookieNames(request).length === 0) {
    return NextResponse.next();
  }

  return NextResponse.next({
    request: {
      headers: buildRequestHeadersWithoutTombstones(request),
    },
  });
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    isEmployeeProtectedPath(pathname) &&
    !requestHasEmployeeSessionCookie(request)
  ) {
    return NextResponse.redirect(new URL("/mi/entrar", request.nextUrl));
  }

  if (isProtectedPath(pathname) && !requestHasAuthjsSessionCookie(request)) {
    return finalizeAuthProxyResponse(
      request,
      NextResponse.redirect(
        new URL(
          `/login?callbackUrl=${encodeURIComponent(pathname)}`,
          request.nextUrl,
        ),
      ),
    );
  }

  if (isAuthPath(pathname)) {
    return finalizeAuthProxyResponse(
      request,
      nextWithSanitizedCookies(request),
    );
  }

  return finalizeAuthProxyResponse(request, NextResponse.next());
}

export default proxy;

export const config = {
  matcher: [
    "/admin/:path*",
    "/app/:path*",
    "/empresa",
    "/login",
    "/api/auth/:path*",
    "/mi",
    "/mi/:path*",
  ],
};
