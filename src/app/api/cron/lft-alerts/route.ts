import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/env";
import { runLftAlertsForAllCompanies } from "@/lib/lft-alerts";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Optional daily run of the LFT alerts (W2-19) for every company, for a
 * scheduler with `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET
 * the route is off (404). The HR home already runs the checks once a day
 * per company, so this only matters for a company nobody opens; adding the
 * schedule is Jorge's decision and this route changes no platform setting.
 * A company already checked in the last 20 hours is skipped.
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

  const result = await runLftAlertsForAllCompanies();

  logger.info(result, "lft alerts job");

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
};
