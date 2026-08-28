import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import {
  requestHasLogoutLatch,
  resolveAuthRouting,
  resolveLatchedProxyResponse,
} from "@/lib/auth/proxy-guard";

const authorizedProxy = auth((request) =>
  resolveAuthRouting({
    pathname: request.nextUrl.pathname,
    nextUrl: request.nextUrl,
    isLoggedIn: Boolean(request.auth),
  }),
) as (request: NextRequest) => ReturnType<typeof resolveAuthRouting>;

export default function proxy(request: NextRequest) {
  if (requestHasLogoutLatch(request)) {
    return resolveLatchedProxyResponse(request);
  }

  return authorizedProxy(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/app/:path*",
    "/login",
    "/api/auth/session",
    "/api/auth/session/",
  ],
};
