import { appendLogoutLatchCookie, isHttpsUrl } from "@/lib/auth/logout-latch";
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
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  const { signOut } = await import("@/auth");
  await signOut({ redirect: false, redirectTo });

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  appendLogoutLatchCookie(headers, isHttpsUrl(request.url));

  return new Response(buildSignOutHtml(redirectTo, origin), {
    status: 200,
    headers,
  });
};
