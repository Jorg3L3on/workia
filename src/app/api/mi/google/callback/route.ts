import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import {
  decodeFlow,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_STATE_COOKIE,
  GOOGLE_TOKEN_URL,
  verifiedEmailFromIdToken,
} from "@/lib/employee-accounts/google";
import { employeeSessionCookieName } from "@/lib/employee-accounts/session";
import { signInWithVerifiedEmail } from "@/lib/employee-accounts/sign-in";
import { logger } from "@/lib/logger";

const publicOrigin = (request: NextRequest) =>
  env.APP_PUBLIC_URL
    ? new URL(env.APP_PUBLIC_URL).origin
    : request.nextUrl.origin;

/**
 * Google comes back here (W2-01). The code is exchanged with PKCE, the ID
 * token's claims are checked, and only an employee account with that
 * verified email signs in. Anything else lands on /mi/entrar with an error.
 */
export const GET = async (request: NextRequest) => {
  const origin = publicOrigin(request);
  const fail = (reason: string) => {
    const response = NextResponse.redirect(
      new URL(`/mi/entrar?error=${reason}`, origin),
    );
    response.cookies.delete({
      name: GOOGLE_STATE_COOKIE,
      path: GOOGLE_CALLBACK_PATH,
    });
    return response;
  };

  const flow = decodeFlow(request.cookies.get(GOOGLE_STATE_COOKIE)?.value);
  const code = request.nextUrl.searchParams.get("code");

  if (
    !env.AUTH_GOOGLE_ID ||
    !env.AUTH_GOOGLE_SECRET ||
    !flow ||
    !code ||
    request.nextUrl.searchParams.get("state") !== flow.state
  ) {
    return fail("google");
  }

  let idToken: string | undefined;

  try {
    const exchange = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.AUTH_GOOGLE_ID,
        client_secret: env.AUTH_GOOGLE_SECRET,
        redirect_uri: new URL(GOOGLE_CALLBACK_PATH, origin).toString(),
        grant_type: "authorization_code",
        code_verifier: flow.verifier,
      }),
    });
    idToken = exchange.ok
      ? ((await exchange.json()) as { id_token?: string }).id_token
      : undefined;
  } catch (error) {
    logger.warn({ err: error }, "Employee Google token exchange failed");
  }

  const email = idToken
    ? verifiedEmailFromIdToken(idToken, {
        clientId: env.AUTH_GOOGLE_ID,
        nonce: flow.nonce,
      })
    : null;

  if (!email) {
    return fail("google");
  }

  const result = await signInWithVerifiedEmail({ email, provider: "google" });

  if (!result.ok) {
    return fail("google-cuenta");
  }

  const response = NextResponse.redirect(new URL("/mi", origin));
  response.cookies.delete({
    name: GOOGLE_STATE_COOKIE,
    path: GOOGLE_CALLBACK_PATH,
  });
  response.cookies.set(employeeSessionCookieName(), result.session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: result.session.expiresAt,
  });

  return response;
};
