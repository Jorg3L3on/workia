import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env";

/**
 * Two-step confirmation of writes (spec §7, D-06): the first call returns a
 * preview and a token bound to the user, the connection, the tool and the
 * exact arguments; only a second call with that token writes. 10 minutes.
 */
export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/** Fields that control the call, not what it does: never part of the hash. */
const CONTROL_FIELDS = new Set(["confirmation_token", "idempotency_key"]);

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
};

/** SHA-256 of the arguments in a stable key order, without the control fields. */
export const argsHash = (args: Record<string, unknown>) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        stable(
          Object.fromEntries(
            Object.entries(args).filter(([key]) => !CONTROL_FIELDS.has(key)),
          ),
        ),
      ),
    )
    .digest("base64url");

export type ConfirmationBinding = {
  userId: string;
  connectionId: string;
  tool: string;
  argsHash: string;
};

const signingKey = () =>
  createHmac("sha256", env.AUTH_SECRET).update("workia-mcp-confirm").digest();

const sign = (payload: string) =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

const bindingString = (binding: ConfirmationBinding, expiresAt: number) =>
  [
    binding.userId,
    binding.connectionId,
    binding.tool,
    binding.argsHash,
    expiresAt,
  ].join("|");

export const issueConfirmationToken = (
  binding: ConfirmationBinding,
  now = Date.now(),
) => {
  const expiresAt = now + CONFIRMATION_TTL_MS;

  return {
    token: `${expiresAt}.${sign(bindingString(binding, expiresAt))}`,
    expiresAt: new Date(expiresAt),
  };
};

/** True only for an unexpired token issued for exactly this binding. */
export const verifyConfirmationToken = (
  token: string,
  binding: ConfirmationBinding,
  now = Date.now(),
) => {
  const [rawExpiry, signature] = token.split(".");
  const expiresAt = Number(rawExpiry);

  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now) {
    return false;
  }

  const expected = Buffer.from(sign(bindingString(binding, expiresAt)));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
