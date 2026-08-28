import { hasLogoutLatch } from "@/lib/auth/logout-latch";

export const PROXY_MATCHER = [
  "/admin/:path*",
  "/app/:path*",
  "/login",
  "/api/auth/session",
  "/api/auth/session/",
] as const;

export const isAuthSessionPath = (pathname: string) =>
  pathname === "/api/auth/session" || pathname === "/api/auth/session/";

export const unauthenticatedSessionResponse = () =>
  new Response("null", {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });

type AuthRoutingInput = {
  pathname: string;
  nextUrl: URL;
  isLoggedIn: boolean;
};

export const resolveAuthRouting = ({
  pathname,
  nextUrl,
  isLoggedIn,
}: AuthRoutingInput) => {
  const isProtectedRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/app");
  const isAuthRoute = pathname.startsWith("/login");

  if (isAuthRoute && isLoggedIn) {
    return Response.redirect(new URL("/app", nextUrl));
  }

  if (isProtectedRoute && !isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }

  return undefined;
};

export const resolveLatchedProxyResponse = (request: { nextUrl: URL }) => {
  const { pathname } = request.nextUrl;

  if (isAuthSessionPath(pathname)) {
    return unauthenticatedSessionResponse();
  }

  return resolveAuthRouting({
    pathname,
    nextUrl: request.nextUrl,
    isLoggedIn: false,
  });
};

export const requestHasLogoutLatch = (request: { headers: Headers }) =>
  hasLogoutLatch(request.headers.get("cookie"));
