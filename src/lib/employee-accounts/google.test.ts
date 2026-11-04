import { describe, expect, it } from "vitest";

import {
  decodeFlow,
  encodeFlow,
  googleAuthorizeUrl,
  newGoogleFlow,
  verifiedEmailFromIdToken,
} from "./google";

const token = (claims: Record<string, unknown>) =>
  [
    Buffer.from('{"alg":"RS256"}').toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "firma",
  ].join(".");

const now = Date.UTC(2026, 10, 4, 12);
const valid = {
  iss: "https://accounts.google.com",
  aud: "client-id",
  exp: now / 1000 + 300,
  nonce: "n",
  email: "ana@empresa.mx",
  email_verified: true,
};

describe("employee Google sign-in", () => {
  it("asks Google for the email with state, nonce and PKCE", () => {
    const flow = newGoogleFlow();
    const url = new URL(
      googleAuthorizeUrl({
        clientId: "client-id",
        redirectUri: "https://workia.example/api/mi/google/callback",
        flow,
      }),
    );

    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("nonce")).toBe(flow.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(flow.verifier);
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
    expect(decodeFlow("no-es-json")).toBeNull();
  });

  it("accepts only a verified email for this client and nonce", () => {
    const expected = { clientId: "client-id", nonce: "n", now };

    expect(verifiedEmailFromIdToken(token(valid), expected)).toBe(
      "ana@empresa.mx",
    );
    expect(
      verifiedEmailFromIdToken(
        token({ ...valid, email_verified: false }),
        expected,
      ),
    ).toBeNull();
    expect(
      verifiedEmailFromIdToken(token({ ...valid, aud: "otro" }), expected),
    ).toBeNull();
    expect(
      verifiedEmailFromIdToken(token({ ...valid, nonce: "otro" }), expected),
    ).toBeNull();
    expect(
      verifiedEmailFromIdToken(
        token({ ...valid, iss: "https://evil.example" }),
        expected,
      ),
    ).toBeNull();
    expect(
      verifiedEmailFromIdToken(
        token({ ...valid, exp: now / 1000 - 1 }),
        expected,
      ),
    ).toBeNull();
    expect(verifiedEmailFromIdToken("basura", expected)).toBeNull();
  });
});
