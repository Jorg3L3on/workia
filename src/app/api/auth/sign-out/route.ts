import { NextResponse } from "next/server";

import { signOut } from "@/auth";
import { applyAuthCookieClearing } from "@/lib/auth/clear-auth-cookies";
import {
  getSafeSignOutRedirect,
  isSameOriginSignOutRequest,
} from "@/lib/auth/validate-sign-out-origin";

export const POST = async (request: Request) => {
  if (!isSameOriginSignOutRequest(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    await signOut({ redirect: false });
  } catch {
    // Explicit cookie clearing below is the reliable logout path on HTTPS.
  }

  const formData = await request.formData();
  const redirectTo = getSafeSignOutRedirect(
    formData.get("redirectTo")?.toString() ?? null,
  );

  const response = NextResponse.redirect(new URL(redirectTo, request.url), 302);
  applyAuthCookieClearing(response);

  return response;
};
