import { createHash, randomBytes } from "node:crypto";

/**
 * Google sign-in for employees (W2-01): OpenID Connect with PKCE, on the same
 * Google client as HR (AUTH_GOOGLE_ID), with its own redirect URI
 * /api/mi/google/callback. It never goes through Auth.js, so it never creates
 * an HR user; it only finds the employee account with the verified email.
 */

export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_STATE_COOKIE = "workia.employee-google";
export const GOOGLE_CALLBACK_PATH = "/api/mi/google/callback";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

export type GoogleFlowState = {
  state: string;
  nonce: string;
  verifier: string;
};

const random = () => randomBytes(32).toString("base64url");

export const newGoogleFlow = (): GoogleFlowState => ({
  state: random(),
  nonce: random(),
  verifier: random(),
});

export const encodeFlow = (flow: GoogleFlowState) =>
  Buffer.from(JSON.stringify(flow)).toString("base64url");

export const decodeFlow = (value?: string | null): GoogleFlowState | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    return typeof parsed?.state === "string" &&
      typeof parsed?.nonce === "string" &&
      typeof parsed?.verifier === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export const googleAuthorizeUrl = (input: {
  clientId: string;
  redirectUri: string;
  flow: GoogleFlowState;
}) => {
  const url = new URL(GOOGLE_AUTHORIZE_URL);

  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: input.flow.state,
    nonce: input.flow.nonce,
    code_challenge: createHash("sha256")
      .update(input.flow.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  return url.toString();
};

/**
 * The verified email of an ID token Google's token endpoint returned over
 * TLS to this server (so its signature needs no separate check, OIDC Core
 * 3.1.3.7): issuer, audience, expiry, nonce and email_verified must hold.
 */
export const verifiedEmailFromIdToken = (
  idToken: string,
  expected: { clientId: string; nonce: string; now?: number },
): string | null => {
  const [, payload] = idToken.split(".");

  if (!payload) {
    return null;
  }

  let claims: Record<string, unknown>;

  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (
    !GOOGLE_ISSUERS.includes(String(claims.iss)) ||
    !audience.includes(expected.clientId) ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    claims.nonce !== expected.nonce ||
    claims.email_verified !== true ||
    typeof claims.email !== "string"
  ) {
    return null;
  }

  return claims.email;
};
