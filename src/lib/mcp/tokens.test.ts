import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateToken,
  hashToken,
  isValidPkceVerifier,
  lookupPrefix,
  tokenKind,
  verifyPkceS256,
  verifyTokenHash,
} from "./tokens";

describe("Workia tokens", () => {
  it.each([
    ["pat", "workia_pat_"],
    ["access", "workia_at_"],
    ["refresh", "workia_rt_"],
    ["code", "workia_code_"],
  ] as const)(
    "%s tokens start with %s and carry 32 random bytes",
    (kind, prefix) => {
      const { token, prefix: lookup, hash } = generateToken(kind);

      expect(token.startsWith(prefix)).toBe(true);
      expect(Buffer.from(token.slice(prefix.length), "base64url")).toHaveLength(
        32,
      );
      expect(lookup).toBe(token.slice(0, prefix.length + 12));
      expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(tokenKind(token)).toBe(kind);
    },
  );

  it("stores a hash that verifies only the same token", () => {
    const { token, hash } = generateToken("pat");

    expect(verifyTokenHash(token, hash)).toBe(true);
    expect(verifyTokenHash(`${token}x`, hash)).toBe(false);
    expect(verifyTokenHash(token, hashToken("otro"))).toBe(false);
    expect(verifyTokenHash(token, "no-es-hex")).toBe(false);
  });

  it("never treats foreign strings as Workia tokens", () => {
    expect(tokenKind("Bearer abc")).toBeNull();
    expect(lookupPrefix("workia_pat_corto")).toBeNull();
  });

  it("checks PKCE S256 (RFC 7636 appendix B)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    expect(isValidPkceVerifier(verifier)).toBe(true);
    expect(
      verifyPkceS256(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),
    ).toBe(true);
    expect(verifyPkceS256(verifier, "otro")).toBe(false);
    expect(isValidPkceVerifier("corto")).toBe(false);
  });
});
