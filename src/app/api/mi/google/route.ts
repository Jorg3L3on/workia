import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import {
  encodeFlow,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_STATE_COOKIE,
  googleAuthorizeUrl,
  newGoogleFlow,
} from "@/lib/employee-accounts/google";

const publicOrigin = (request: NextRequest) =>
  env.APP_PUBLIC_URL
    ? new URL(env.APP_PUBLIC_URL).origin
    : request.nextUrl.origin;

/** Starts employee Google sign-in (W2-01): state, nonce and PKCE in a short cookie. */
export const GET = async (request: NextRequest) => {
  const origin = publicOrigin(request);

  if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    return NextResponse.redirect(new URL("/mi/entrar?error=google", origin));
  }

  const flow = newGoogleFlow();
  const response = NextResponse.redirect(
    googleAuthorizeUrl({
      clientId: env.AUTH_GOOGLE_ID,
      redirectUri: new URL(GOOGLE_CALLBACK_PATH, origin).toString(),
      flow,
    }),
  );

  response.cookies.set(GOOGLE_STATE_COOKIE, encodeFlow(flow), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: GOOGLE_CALLBACK_PATH,
    maxAge: 10 * 60,
  });

  return response;
};
