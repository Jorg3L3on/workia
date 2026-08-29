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
  pathname.startsWith("/admin/");

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
  matcher: ["/admin/:path*", "/app/:path*", "/login", "/api/auth/:path*"],
};
