/** Retry and retention policy of notification sending (W2-08). Pure, no database. */

/** Waits after the 1st, 2nd, … failed attempt. After the last one it is failed. */
export const RETRY_DELAYS_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 60 * 60_000, // 2 h
  12 * 60 * 60_000, // 12 h
] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** How long a claimed delivery is held before another run may take it. */
export const CLAIM_LEASE_MS = 10 * 60_000;

/** Messages older than this are deleted with their log (Neon Free: 1 GB). */
export const NOTIFICATION_RETENTION_DAYS = 365;

/** Deliveries one run sends, and old messages one run deletes. */
export const SEND_BATCH = 25;
export const PRUNE_BATCH = 500;

export type DeliveryOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "retry"; error: string };

/** What a failed attempt becomes: pending again later, or failed for good. */
export const afterFailure = (attempts: number, now: Date) =>
  attempts >= MAX_ATTEMPTS
    ? { status: "failed" as const, nextAttemptAt: null }
    : {
        status: "pending" as const,
        nextAttemptAt: new Date(
          now.getTime() + RETRY_DELAYS_MS[Math.max(0, attempts - 1)]!,
        ),
      };
