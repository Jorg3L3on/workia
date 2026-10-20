import { lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

export type RateLimitResult = {
  limited: boolean;
  count: number;
  retryAfterSeconds: number;
};

/** Windows older than this are deleted now and then, lazily. */
const PRUNE_AFTER_MS = 2 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.01;

/**
 * Fixed-window counter in Postgres (spec §7): one row per key and window,
 * incremented atomically. Works across serverless instances without Redis.
 */
export const hitRateLimit = async (
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<RateLimitResult> => {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  if (Math.random() < PRUNE_PROBABILITY) {
    await db
      .delete(rateLimits)
      .where(
        lt(rateLimits.windowStart, new Date(now.getTime() - PRUNE_AFTER_MS)),
      );
  }

  const count = row?.count ?? 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  );

  return { limited: count > limit, count, retryAfterSeconds };
};

/** The caller's IP for per-IP limits (Vercel sets x-forwarded-for). */
export const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";
