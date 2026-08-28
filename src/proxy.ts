import type { NextFetchEvent, NextRequest } from "next/server";

import { auth } from "@/auth";
import {
  PROXY_MATCHER,
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
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (requestHasLogoutLatch(request)) {
    return resolveLatchedProxyResponse(request);
  }

  return authorizedProxy(request, event);
}

export const config = {
  matcher: [...PROXY_MATCHER],
};
