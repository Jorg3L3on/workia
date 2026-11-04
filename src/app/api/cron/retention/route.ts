import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/env";
import { logger } from "@/lib/logger";
import { runRetentionJob } from "@/lib/privacy/retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Retention job (W2-09): deletes the personal data past its automatic period
 * (src/lib/privacy/retention.ts), in batches, company by company. Called by a
 * scheduler with `Authorization: Bearer <CRON_SECRET>`, the header Vercel
 * Cron sends. Without CRON_SECRET the route is off (404). Jorge adds the
 * schedule; this route does not change any platform setting.
 */
export const GET = async (request: Request) => {
  const secret = env.CRON_SECRET;

  if (!secret) {
    return new NextResponse(null, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!sameSecret(given, secret)) {
    return new NextResponse(null, { status: 401 });
  }

  const results = await runRetentionJob();
  const deleted = results.reduce(
    (sum, row) => sum + row.accessLog + row.arcoRequests,
    0,
  );
  const more = results.some((row) => row.more);

  logger.info({ deleted, more, companies: results.length }, "retention job");

  return NextResponse.json(
    { companies: results.length, deleted, more },
    { headers: { "Cache-Control": "no-store" } },
  );
};
