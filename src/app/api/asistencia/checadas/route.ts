import { NextResponse } from "next/server";

import { deviceForToken, markDevicePush } from "@/lib/attendance";
import { parseDevicePush } from "@/lib/attendance/device-push";
import { ingestPunches } from "@/lib/attendance/ingest";
import { logger } from "@/lib/logger";
import { clientIp, hitRateLimit } from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Largest body a push may send: about 1,000 punches. */
const MAX_BODY_BYTES = 256 * 1024;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

/**
 * Device push (W2-12, docs/asistencia.md): a checador, or the software next
 * to it, POSTs its punches with `Authorization: Bearer <device token>`. The
 * token names the checador and its company; there is no session. Punches are
 * ingested like a CSV upload of that checador: idempotent, and those it
 * cannot place go to HR's report.
 */
export const POST = async (request: Request) => {
  const ip = clientIp(request);
  const perIp = await hitRateLimit(`attendance-push:ip:${ip}`, 120, 60_000);

  if (perIp.limited) {
    return json({ error: "rate_limited" }, 429, {
      "Retry-After": String(perIp.retryAfterSeconds),
    });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const device = token ? await deviceForToken(token) : null;

  if (!device) {
    return json({ error: "unauthorized" }, 401);
  }

  const perDevice = await hitRateLimit(
    `attendance-push:device:${device.id}`,
    60,
    60_000,
  );

  if (perDevice.limited) {
    return json({ error: "rate_limited" }, 429, {
      "Retry-After": String(perDevice.retryAfterSeconds),
    });
  }

  const length = Number(request.headers.get("content-length") ?? 0);

  if (length > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }

  const text = await request.text();

  if (text.length > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }

  const parsed = parseDevicePush(text);

  if (!parsed.ok) {
    return json({ error: "invalid_body", detail: parsed.error }, 400);
  }

  const now = new Date();
  const summary = await ingestPunches(
    device.companyId,
    {
      kind: "batch",
      source: "device",
      deviceId: device.id,
      siteId: device.siteId,
    },
    parsed.punches,
    parsed.invalid,
    { now },
  );

  await markDevicePush(device.companyId, device.id, now);

  logger.info(
    {
      deviceId: device.id,
      added: summary.punchesAdded,
      duplicates: summary.duplicates,
      unmatched: summary.unmatched,
      invalid: summary.invalid,
    },
    "attendance push",
  );

  return json({
    received: summary.rows,
    added: summary.punchesAdded,
    duplicates: summary.duplicates,
    unmatched: summary.unmatched,
    invalid: summary.invalid,
  });
};
