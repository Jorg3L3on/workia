import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { sweepDueNotifications } from "@/lib/notifications/delivery";

/**
 * Retry sweep of notifications (W2-08), for a scheduled job. Sessionless:
 * it answers only with `Authorization: Bearer <CRON_SECRET>`, and 404 while
 * CRON_SECRET is unset. Retries also run after every new message, so this is
 * optional; adding the cron entry is Jorge's call (platform setting).
 */
const authorized = (request: NextRequest) => {
  const secret = env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";

  if (!secret) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);

  return expected.length === given.length && timingSafeEqual(expected, given);
};

export const GET = async (request: NextRequest) => {
  if (!env.CRON_SECRET) {
    return new NextResponse(null, { status: 404 });
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const totals = await sweepDueNotifications();

  return NextResponse.json(totals);
};
