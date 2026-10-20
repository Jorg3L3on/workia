import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Workia bearer credentials (spec §6). Each one is a fixed prefix plus 32
 * random bytes in base64url. The database keeps the first LOOKUP_LENGTH
 * characters (to find the row) and a SHA-256 hash (to verify it), never the
 * token itself.
 */
export const TOKEN_PREFIXES = {
  pat: "workia_pat_",
  access: "workia_at_",
  refresh: "workia_rt_",
  code: "workia_code_",
  clientSecret: "workia_cs_",
} as const;

export type TokenKind = keyof typeof TOKEN_PREFIXES;

/** Prefix + 12 random characters: enough to find the row, useless to guess the rest. */
const LOOKUP_RANDOM_CHARS = 12;

export type GeneratedToken = {
  token: string;
  prefix: string;
  hash: string;
};

export const lookupPrefix = (token: string) => {
  const kind = tokenKind(token);

  if (!kind) {
    return null;
  }

  const length = TOKEN_PREFIXES[kind].length + LOOKUP_RANDOM_CHARS;
  return token.length > length ? token.slice(0, length) : null;
};

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const generateToken = (kind: TokenKind): GeneratedToken => {
  const token = `${TOKEN_PREFIXES[kind]}${randomBytes(32).toString("base64url")}`;

  return { token, prefix: lookupPrefix(token)!, hash: hashToken(token) };
};

/** Constant-time comparison of a presented token against a stored hash. */
export const verifyTokenHash = (token: string, storedHash: string) => {
  const expected = Buffer.from(storedHash, "hex");
  const actual = createHash("sha256").update(token).digest();

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const tokenKind = (token: string): TokenKind | null => {
  for (const [kind, prefix] of Object.entries(TOKEN_PREFIXES)) {
    if (token.startsWith(prefix)) {
      return kind as TokenKind;
    }
  }

  return null;
};

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export const verifyPkceS256 = (verifier: string, challenge: string) => {
  const digest = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(digest);
  const b = Buffer.from(challenge);

  return a.length === b.length && timingSafeEqual(a, b);
};

/** RFC 7636: 43–128 characters of [A-Z a-z 0-9 - . _ ~]. */
export const isValidPkceVerifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
