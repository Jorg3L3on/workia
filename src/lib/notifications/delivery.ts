import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import { env } from "@/env";
import { db, tdb, withTransaction } from "@/lib/db";
import {
  companyMemberships,
  employeeAccounts,
  notificationDeliveries,
  notifications,
  users,
} from "@/lib/db/schema";
import { EmailNotConfiguredError, sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

import {
  afterFailure,
  CLAIM_LEASE_MS,
  NOTIFICATION_RETENTION_DAYS,
  PRUNE_BATCH,
  SEND_BATCH,
  type DeliveryOutcome,
} from "./policy";
import { sendPushToPerson } from "./push";

export * from "./policy";
import { notificationEmail, type RecipientKind } from "./templates";

/**
 * Sending (W2-08). Pending email and push deliveries are claimed with
 * FOR UPDATE SKIP LOCKED and a lease, sent, and marked sent, skipped, or
 * pending again with backoff. A failure never touches the notification row:
 * the message stays in the in-app inbox whatever its email does.
 *
 * Who runs it, at no cost and with no new platform setting:
 *   - right after the commit that created the messages (sendNotificationsSoon);
 *   - each of those runs also picks up the company's due retries;
 *   - /api/cron/notifications sweeps every company, if Jorge adds a cron entry.
 */

/** The public origin for links in emails, also from a cron run without a request. */
export const notificationOrigin = () => {
  if (env.APP_PUBLIC_URL) {
    return new URL(env.APP_PUBLIC_URL).origin;
  }

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  return vercel ? `https://${vercel}` : "http://localhost:3000";
};

type Claimed = {
  deliveryId: string;
  channel: "email" | "push";
  attempts: number;
  notificationId: string;
  recipientPersonId: string | null;
  recipientUserId: string | null;
  title: string;
  body: string;
  url: string | null;
};

const claim = (companyId: string, limit: number) =>
  withTransaction(async (tx) => {
    const now = new Date();
    const due = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.companyId, companyId),
          eq(notificationDeliveries.status, "pending"),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(notificationDeliveries.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) {
      return [];
    }

    await tx
      .update(notificationDeliveries)
      .set({
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      })
      .where(
        and(
          eq(notificationDeliveries.companyId, companyId),
          inArray(
            notificationDeliveries.id,
            due.map((row) => row.id),
          ),
        ),
      );

    return tx
      .select({
        deliveryId: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        attempts: notificationDeliveries.attempts,
        notificationId: notifications.id,
        recipientPersonId: notifications.recipientPersonId,
        recipientUserId: notifications.recipientUserId,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notifications,
        and(
          eq(notifications.companyId, notificationDeliveries.companyId),
          eq(notifications.id, notificationDeliveries.notificationId),
        ),
      )
      .where(
        and(
          eq(notificationDeliveries.companyId, companyId),
          inArray(
            notificationDeliveries.id,
            due.map((row) => row.id),
          ),
        ),
      ) as Promise<Claimed[]>;
  }, companyId);

/** The address a recipient's email goes to, or null when there is none to use. */
const emailAddressOf = async (companyId: string, item: Claimed) => {
  if (item.recipientPersonId) {
    const [account] = await tdb(companyId)
      .select({ email: employeeAccounts.email })
      .from(employeeAccounts)
      .where(
        and(
          eq(employeeAccounts.companyId, companyId),
          eq(employeeAccounts.personId, item.recipientPersonId),
          eq(employeeAccounts.status, "active"),
        ),
      )
      .limit(1);

    return account?.email ?? null;
  }

  // An HR user, while their membership in the company is active.
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.userId, users.id),
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.status, "activa"),
      ),
    )
    .where(eq(users.id, item.recipientUserId!))
    .limit(1);

  return user?.email ?? null;
};

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500);

const deliverEmail = async (
  companyId: string,
  item: Claimed,
): Promise<DeliveryOutcome> => {
  const to = await emailAddressOf(companyId, item);

  if (!to) {
    return { status: "skipped", reason: "no_address" };
  }

  const kind: RecipientKind = item.recipientPersonId ? "person" : "user";
  const message = notificationEmail(
    { title: item.title, body: item.body, url: item.url ?? "/" },
    notificationOrigin(),
    kind,
  );

  try {
    await sendEmail({ to, ...message });
    return { status: "sent" };
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return { status: "skipped", reason: "not_configured" };
    }

    return { status: "retry", error: errorText(error) };
  }
};

const deliver = async (
  companyId: string,
  item: Claimed,
): Promise<DeliveryOutcome> => {
  if (item.channel === "email") {
    return deliverEmail(companyId, item);
  }

  if (!item.recipientPersonId) {
    return { status: "skipped", reason: "no_device" };
  }

  return sendPushToPerson(companyId, item.recipientPersonId, {
    title: item.title,
    body: item.body,
    url: item.url ?? "/mi/avisos",
    tag: item.notificationId,
  });
};

const record = async (
  companyId: string,
  item: Claimed,
  outcome: DeliveryOutcome,
) => {
  const now = new Date();
  const values =
    outcome.status === "sent"
      ? {
          status: "sent" as const,
          sentAt: now,
          nextAttemptAt: null,
          lastError: null,
        }
      : outcome.status === "skipped"
        ? {
            status: "skipped" as const,
            nextAttemptAt: null,
            lastError: outcome.reason,
          }
        : { ...afterFailure(item.attempts, now), lastError: outcome.error };

  await tdb(companyId)
    .update(notificationDeliveries)
    .set(values)
    .where(
      and(
        eq(notificationDeliveries.companyId, companyId),
        eq(notificationDeliveries.id, item.deliveryId),
        // A channel turned off meanwhile already skipped it; keep that.
        eq(notificationDeliveries.status, "pending"),
      ),
    );
};

/** Deletes the company's oldest messages past retention, a batch at a time. */
export const pruneOldNotifications = async (
  companyId: string,
  now = new Date(),
) => {
  const cutoff = new Date(
    now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60_000,
  );
  // Only builds the subquery; tdb() runs the delete under the company.
  const oldest = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        lt(notifications.createdAt, cutoff),
      ),
    )
    .limit(PRUNE_BATCH);
  const deleted = await tdb(companyId)
    .delete(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        inArray(notifications.id, oldest),
      ),
    )
    .returning({ id: notifications.id });

  return deleted.length;
};

/**
 * Sends the company's due email and push deliveries (new ones and retries).
 * Returns how many ended in each state; never throws for one bad delivery.
 */
export const sendDueNotifications = async (
  companyId: string,
  limit = SEND_BATCH,
) => {
  const claimed = await claim(companyId, limit);
  const counts = { sent: 0, skipped: 0, retry: 0 };

  for (const item of claimed) {
    let outcome: DeliveryOutcome;

    try {
      outcome = await deliver(companyId, item);
    } catch (error) {
      outcome = { status: "retry", error: errorText(error) };
    }

    if (outcome.status === "retry") {
      logger.warn(
        {
          companyId,
          deliveryId: item.deliveryId,
          channel: item.channel,
          attempts: item.attempts,
          error: outcome.error,
        },
        "Notification delivery failed",
      );
    }

    await record(companyId, item, outcome);
    counts[outcome.status] += 1;
  }

  return counts;
};

/**
 * After the response: sends what is due for the company, then trims old
 * messages. For server actions and route handlers, once their transaction
 * has committed. Outside a request (scripts, tests) it sends inline.
 */
export const sendNotificationsSoon = async (companyId: string) => {
  const run = async () => {
    try {
      await sendDueNotifications(companyId);
      await pruneOldNotifications(companyId);
    } catch (error) {
      logger.error({ companyId, err: error }, "Notification sending failed");
    }
  };

  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
};

/**
 * The retry sweep of /api/cron/notifications: every company with a due
 * delivery, found by the SECURITY DEFINER function of migration 0040, then
 * sent under that company's RLS.
 */
export const sweepDueNotifications = async (maxCompanies = 50) => {
  const result = await db.execute<{ company_id: string }>(
    sql`select notification_due_companies(${maxCompanies}) as company_id`,
  );
  const rows = (
    Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
  ) as { company_id: string }[];
  const totals = { companies: rows.length, sent: 0, skipped: 0, retry: 0 };

  for (const { company_id: companyId } of rows) {
    const counts = await sendDueNotifications(companyId);
    totals.sent += counts.sent;
    totals.skipped += counts.skipped;
    totals.retry += counts.retry;
    await pruneOldNotifications(companyId);
  }

  return totals;
};
