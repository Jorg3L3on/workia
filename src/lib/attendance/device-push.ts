import { z } from "zod";

import { parsePunchTime, trimRaw } from "./csv-format";
import type { IncomingPunch, InvalidRow } from "./ingest";

/**
 * The body of a device push (W2-12):
 *
 *   { "punches": [ { "badge": "123", "at": "2026-11-03T08:12:00-06:00", "kind": "in" } ] }
 *
 * `at` is an ISO instant with offset, or the checador's local time
 * ("2026-11-03 08:12:00"), read in the site's zone. `kind` ("in" | "out")
 * is optional. Up to 1,000 punches per request; a punch that does not read is
 * reported to HR with its raw values, the rest are still ingested.
 */
export const MAX_PUNCHES_PER_PUSH = 1_000;

const bodySchema = z.object({
  punches: z.array(z.unknown()).min(1).max(MAX_PUNCHES_PER_PUSH),
});

const punchSchema = z.object({
  badge: z.union([z.string(), z.number()]).transform(String),
  at: z.string().min(10).max(40),
  kind: z.enum(["in", "out"]).nullish(),
});

const rawOf = (value: unknown): string[] => {
  if (value && typeof value === "object") {
    return trimRaw(
      Object.entries(value as Record<string, unknown>).map(
        ([key, cell]) => `${key}=${typeof cell === "string" ? cell : JSON.stringify(cell)}`,
      ),
    );
  }

  return trimRaw([JSON.stringify(value) ?? ""]);
};

export const parseDevicePush = (
  text: string,
):
  | { ok: true; punches: IncomingPunch[]; invalid: InvalidRow[] }
  | { ok: false; error: string } => {
  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "The body is not JSON." };
  }

  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      error: `Send { "punches": [...] } with 1 to ${MAX_PUNCHES_PER_PUSH} punches.`,
    };
  }

  const punches: IncomingPunch[] = [];
  const invalid: InvalidRow[] = [];

  parsed.data.punches.forEach((value, index) => {
    const line = index + 1;
    const raw = rawOf(value);
    const punch = punchSchema.safeParse(value);

    if (!punch.success) {
      invalid.push({ line, raw, error: "La checada no trae número, fecha u hora válidos." });
      return;
    }

    const badge = punch.data.badge.trim();
    const at = parsePunchTime(punch.data.at.trim(), null, "YYYY-MM-DD");

    if (!badge || badge.length > 40 || !at) {
      invalid.push({ line, raw, error: "La checada no trae número, fecha u hora válidos." });
      return;
    }

    punches.push({ line, raw, badge, at, kind: punch.data.kind ?? null });
  });

  return { ok: true, punches, invalid };
};
