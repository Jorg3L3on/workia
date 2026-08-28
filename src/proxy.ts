import { auth } from "@/auth";
import {
  requestHasLogoutLatch,
  resolveAuthRouting,
  resolveLatchedProxyResponse,
} from "@/lib/auth/proxy-guard";

export default auth((request) => {
  if (requestHasLogoutLatch(request)) {
    return resolveLatchedProxyResponse(request);
  }

  return resolveAuthRouting({
    pathname: request.nextUrl.pathname,
    nextUrl: request.nextUrl,
    isLoggedIn: Boolean(request.auth),
  });
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/app/:path*",
    "/login",
    "/api/auth/session",
    "/api/auth/session/",
  ],
};
