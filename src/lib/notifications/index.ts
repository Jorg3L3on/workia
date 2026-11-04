import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db, tdb, withTransaction, type DbExecutor } from "@/lib/db";
import {
  notificationDeliveries,
  notificationOptOuts,
  notifications,
  type NotificationTemplate,
  type OptionalNotificationChannel,
} from "@/lib/db/schema";

import { recipientKey, type NotificationRecipient } from "./recipients";
import { sendNotificationsSoon } from "./delivery";
import { renderNotification, type TemplateData } from "./templates";

export * from "./recipients";
export { INBOX_PATH, renderNotification, type TemplateData } from "./templates";

/**
 * Notifications (Workia 2.0 W2-08, docs/notificaciones.md). One call writes
 * the in-app message of each recipient and its delivery log: in_app is sent
 * right away (the row is the inbox), email and push start pending unless the
 * recipient turned the channel off. Sending happens after the commit
 * (./delivery.ts), so a failed email never undoes the event that caused it.
 */

export type NotifyInput<T extends NotificationTemplate> = {
  template: T;
  data: TemplateData[T];
  recipients: NotificationRecipient[];
  /**
   * The event this message is about (e.g. `vacation_record:<id>:approved`).
   * With it, the same event creates one message per recipient, however many
   * times it is retried.
   */
  eventKey?: string;
  /** An app path to open instead of the template's default. */
  url?: string;
};

const recipientColumns = (recipient: NotificationRecipient) =>
  recipient.kind === "person"
    ? { recipientPersonId: recipient.personId, recipientUserId: null }
    : { recipientPersonId: null, recipientUserId: recipient.userId };

const recipientWhere = (
  table: typeof notifications | typeof notificationOptOuts,
  recipient: NotificationRecipient,
) =>
  recipient.kind === "person"
    ? eq(table.recipientPersonId, recipient.personId)
    : eq(table.recipientUserId, recipient.userId);

const isAppPath = (url: string) => url.startsWith("/") && !url.startsWith("//");

/** The channels a recipient turned off. */
export const listOptOuts = async (
  companyId: string,
  recipient: NotificationRecipient,
  executor: DbExecutor = tdb(companyId),
): Promise<Set<OptionalNotificationChannel>> => {
  const rows = await executor
    .select({ channel: notificationOptOuts.channel })
    .from(notificationOptOuts)
    .where(
      and(
        eq(notificationOptOuts.companyId, companyId),
        recipientWhere(notificationOptOuts, recipient),
      ),
    );

  return new Set(rows.map((row) => row.channel));
};

/**
 * Writes the notifications in `executor` (pass the caller's transaction to
 * commit them with the event). Returns the ids created; a repeated eventKey
 * creates nothing. Call sendNotificationsSoon(companyId) after the commit.
 */
export const createNotifications = async <T extends NotificationTemplate>(
  companyId: string,
  input: NotifyInput<T>,
  executor?: DbExecutor,
): Promise<string[]> => {
  if (input.url && !isAppPath(input.url)) {
    throw new Error("A notification opens an app path, never an external URL.");
  }

  const write = async (tx: DbExecutor) => {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const recipient of input.recipients) {
      const key = recipientKey(recipient);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const content = renderNotification(
        input.template,
        input.data,
        recipient.kind,
      );
      const [created] = await tx
        .insert(notifications)
        .values({
          companyId,
          ...recipientColumns(recipient),
          template: input.template,
          title: content.title,
          body: content.body,
          url: input.url ?? content.url,
          data: input.data as Record<string, unknown>,
          dedupeKey: input.eventKey
            ? `${input.template}:${input.eventKey}:${key}`
            : null,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });

      if (!created) {
        continue;
      }

      const optOuts = await listOptOuts(companyId, recipient, tx);
      const now = new Date();
      const optional = (channel: OptionalNotificationChannel) =>
        optOuts.has(channel)
          ? {
              channel,
              status: "skipped" as const,
              lastError: "opted_out",
              nextAttemptAt: null,
            }
          : {
              channel,
              status: "pending" as const,
              lastError: null,
              nextAttemptAt: now,
            };

      await tx.insert(notificationDeliveries).values([
        {
          companyId,
          notificationId: created.id,
          channel: "in_app",
          status: "sent",
          sentAt: now,
        },
        { companyId, notificationId: created.id, ...optional("email") },
        // Web push reaches the employee app only; HR reads in the HR app.
        ...(recipient.kind === "person"
          ? [{ companyId, notificationId: created.id, ...optional("push") }]
          : []),
      ]);

      ids.push(created.id);
    }

    return ids;
  };

  return executor ? write(executor) : withTransaction(write, companyId);
};

/**
 * The usual call for a producer outside a transaction: writes the messages,
 * then sends email and push after the response. Inside a transaction, call
 * createNotifications(companyId, input, tx) and, after the commit,
 * sendNotificationsSoon(companyId).
 */
export const notify = async <T extends NotificationTemplate>(
  companyId: string,
  input: NotifyInput<T>,
) => {
  const ids = await createNotifications(companyId, input);

  if (ids.length > 0) {
    await sendNotificationsSoon(companyId);
  }

  return ids;
};

export { sendNotificationsSoon };

// ── Inbox ────────────────────────────────────────────────────────────────

export const INBOX_PAGE_SIZE = 20;

/** Opaque cursor of the inbox keyset: the last row's (created_at, id). */
export const encodeInboxCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");

export const decodeInboxCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");

  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
    return null;
  }

  return { createdAt, id: id! };
};

/**
 * One page of a recipient's inbox, newest first, read from the inbox index
 * with a (created_at, id) keyset: no OFFSET, the same cost on every page.
 */
export const listInboxPage = async (
  companyId: string,
  recipient: NotificationRecipient,
  cursor?: string | null,
) => {
  const after = decodeInboxCursor(cursor);
  const rows = await tdb(companyId)
    .select({
      id: notifications.id,
      template: notifications.template,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        recipientWhere(notifications, recipient),
        after
          ? or(
              lt(notifications.createdAt, after.createdAt),
              and(
                eq(notifications.createdAt, after.createdAt),
                lt(notifications.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(INBOX_PAGE_SIZE + 1);

  const items = rows.slice(0, INBOX_PAGE_SIZE);
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      rows.length > INBOX_PAGE_SIZE && last ? encodeInboxCursor(last) : null,
  };
};

export type InboxItem = Awaited<
  ReturnType<typeof listInboxPage>
>["items"][number];

/** Counted up to this many; the badge shows «99+» beyond it. */
export const UNREAD_COUNT_CAP = 100;

export const countUnread = async (
  companyId: string,
  recipient: NotificationRecipient,
) => {
  // Only builds the subquery; tdb() runs the statement under the company.
  const capped = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        recipientWhere(notifications, recipient),
        isNull(notifications.readAt),
      ),
    )
    .limit(UNREAD_COUNT_CAP)
    .as("capped");
  const [row] = await tdb(companyId)
    .select({ count: sql<number>`count(*)::int` })
    .from(capped);

  return row?.count ?? 0;
};

/**
 * Marks one message of the recipient as read and returns the path it opens,
 * or null when the id is not one of theirs (another person's, another
 * company's, or gone).
 */
export const markNotificationRead = async (
  companyId: string,
  recipient: NotificationRecipient,
  notificationId: string,
) => {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    return null;
  }

  const [row] = await tdb(companyId)
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(
      and(
        eq(notifications.companyId, companyId),
        recipientWhere(notifications, recipient),
        eq(notifications.id, notificationId),
      ),
    )
    .returning({ url: notifications.url });

  return row ? { url: row.url } : null;
};

export const markAllNotificationsRead = async (
  companyId: string,
  recipient: NotificationRecipient,
) => {
  const rows = await tdb(companyId)
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.companyId, companyId),
        recipientWhere(notifications, recipient),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  return rows.length;
};

// ── Opt-out per channel ──────────────────────────────────────────────────

/**
 * Turns email or push on or off for the recipient. Pending deliveries of a
 * channel turned off are skipped too, so nothing more goes out on it.
 */
export const setChannelEnabled = async (
  companyId: string,
  recipient: NotificationRecipient,
  channel: OptionalNotificationChannel,
  enabled: boolean,
) =>
  withTransaction(async (tx) => {
    if (enabled) {
      await tx
        .delete(notificationOptOuts)
        .where(
          and(
            eq(notificationOptOuts.companyId, companyId),
            recipientWhere(notificationOptOuts, recipient),
            eq(notificationOptOuts.channel, channel),
          ),
        );
      return;
    }

    await tx
      .insert(notificationOptOuts)
      .values({ companyId, ...recipientColumns(recipient), channel })
      .onConflictDoNothing();

    const mine = tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          recipientWhere(notifications, recipient),
        ),
      );

    await tx
      .update(notificationDeliveries)
      .set({ status: "skipped", lastError: "opted_out", nextAttemptAt: null })
      .where(
        and(
          eq(notificationDeliveries.companyId, companyId),
          eq(notificationDeliveries.channel, channel),
          eq(notificationDeliveries.status, "pending"),
          inArray(notificationDeliveries.notificationId, mine),
        ),
      );
  }, companyId);
