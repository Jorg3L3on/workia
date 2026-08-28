import {
  appendExpiredAuthCookies,
  collectAuthCookiesToClear,
} from "@/lib/auth/clear-auth-cookies";
import { buildSignOutHtml } from "@/lib/auth/sign-out-html";
import {
  getSafeSignOutRedirect,
  isSameOriginSignOutRequest,
} from "@/lib/auth/validate-sign-out-origin";

export const POST = async (request: Request) => {
  if (!isSameOriginSignOutRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const redirectTo = getSafeSignOutRedirect(
    formData.get("redirectTo")?.toString() ?? null,
  );

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  appendExpiredAuthCookies(headers, collectAuthCookiesToClear(request));

  return new Response(buildSignOutHtml(redirectTo), {
    status: 200,
    headers,
  });
};
