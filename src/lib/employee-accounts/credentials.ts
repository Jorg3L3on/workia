import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { env } from "@/env";

/**
 * Secrets of employee sign-in (W2-01): login codes sent by email, activation
 * codes HR hands out, and session tokens. Only their HMAC (keyed by
 * AUTH_SECRET) is stored, so a database read never yields a usable secret.
 */

/** A login code by email lives ten minutes. */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
/** An activation code from HR lives seven days. */
export const ACTIVATION_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** An employee session lasts thirty days, then the employee signs in again. */
export const EMPLOYEE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Wrong tries a code takes before it stops working. */
export const MAX_CODE_ATTEMPTS = 5;
export const MIN_PASSWORD_LENGTH = 8;

type SecretKind = "login" | "activation" | "session";

/** Trimmed and lower case: how an account stores and compares emails. */
export const normalizeEmail = (value?: string | null) =>
  (value ?? "").trim().toLowerCase();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isPlausibleEmail = (value: string) =>
  value.length <= 254 && EMAIL_PATTERN.test(value);

/** Six digits, any of them may be zero. */
export const generateLoginCode = () =>
  String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Digits only, so «123 456» and «123-456» are the same code. */
export const normalizeLoginCode = (value?: string | null) =>
  (value ?? "").replace(/\D/g, "");

// No 0/O, 1/I/L: the code is read aloud or copied from paper.
const ACTIVATION_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ACTIVATION_LENGTH = 12;

/** «7KQM-2XWP-HD4R»: twelve characters, about 59 bits. */
export const generateActivationCode = () => {
  let code = "";

  for (let index = 0; index < ACTIVATION_LENGTH; index += 1) {
    code += ACTIVATION_ALPHABET[randomInt(0, ACTIVATION_ALPHABET.length)];
  }

  return code.match(/.{4}/g)!.join("-");
};

/** Upper case without spaces or dashes; the form accepts it either way. */
export const normalizeActivationCode = (value?: string | null) =>
  (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export const generateSessionToken = () => randomBytes(32).toString("base64url");

/** HMAC-SHA256 of a secret, as stored. Normalize the value first. */
export const hashSecret = (
  kind: SecretKind,
  value: string,
  secret: string = env.AUTH_SECRET,
) =>
  createHmac("sha256", secret)
    .update(`workia-employee:${kind}:${value}`)
    .digest("hex");

/** Constant-time comparison of two stored hashes. */
export const hashesMatch = (left: string, right: string) => {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");

  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};
