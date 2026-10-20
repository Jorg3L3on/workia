import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { env } from "@/env";

import { McpToolError } from "./errors";

/**
 * Opaque, signed keyset cursors (spec §7): base64url of {k: sort key, i: id,
 * f: hash of the filters} plus an HMAC. A cursor only continues the same list
 * with the same filters; anything else is VALIDATION.
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(
    `Cuántos resultados (por defecto ${DEFAULT_LIMIT}, máximo ${MAX_LIMIT}).`,
  );

export const cursorSchema = z
  .string()
  .max(1000)
  .optional()
  .describe("Cursor opaco devuelto como next_cursor en la página anterior.");

export type KeysetPosition = { key: string; id: string };

const signingKey = () =>
  createHmac("sha256", env.AUTH_SECRET).update("workia-mcp-cursor").digest();

const sign = (payload: string) =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

/** Stable hash of the filters a list ran with (key order does not matter). */
export const filtersHash = (list: string, filters: Record<string, unknown>) => {
  const normalized = Object.keys(filters)
    .sort()
    .filter((key) => filters[key] !== undefined && filters[key] !== null)
    .map((key) => [key, filters[key]]);

  return createHash("sha256")
    .update(JSON.stringify([list, normalized]))
    .digest("base64url")
    .slice(0, 16);
};

export const encodeCursor = (position: KeysetPosition, hash: string) => {
  const payload = Buffer.from(
    JSON.stringify({ k: position.key, i: position.id, f: hash }),
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
};

const invalid = () =>
  new McpToolError(
    "VALIDATION",
    "El cursor no es válido para esta consulta. Repite la consulta sin cursor.",
  );

/** Decodes a cursor for this list and these filters, or throws VALIDATION. */
export const decodeCursor = (
  cursor: string | undefined,
  hash: string,
): KeysetPosition | null => {
  if (!cursor) {
    return null;
  }

  const [payload, signature] = cursor.split(".");

  if (!payload || !signature) {
    throw invalid();
  }

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw invalid();
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      k?: unknown;
      i?: unknown;
      f?: unknown;
    };

    if (
      data.f !== hash ||
      typeof data.k !== "string" ||
      typeof data.i !== "string"
    ) {
      throw invalid();
    }

    return { key: data.k, id: data.i };
  } catch (error) {
    throw error instanceof McpToolError ? error : invalid();
  }
};

/**
 * Splits a limit+1 fetch into the page and the next cursor.
 * `keyOf` returns the sort key of a row as the list orders it.
 */
export const pageOf = <T extends { id: string }>(
  rows: T[],
  limit: number,
  hash: string,
  keyOf: (row: T) => string,
) => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ key: keyOf(last), id: last.id }, hash)
        : null,
  };
};
