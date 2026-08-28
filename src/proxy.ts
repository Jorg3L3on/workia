import { NextRequest, NextResponse } from "next/server";

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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !requestHasAuthjsSessionCookie(request)) {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: ["/admin/:path*", "/app/:path*"],
};
