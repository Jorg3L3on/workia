import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";
import { users } from "./rbac";

/**
 * Notifications (Workia 2.0 W2-08, docs/notificaciones.md). One message to one
 * recipient of one company: a person (they read it in the employee app) or an
 * HR user (they read it in the HR app). The row is the in-app inbox entry,
 * so the message stays there whatever happens to its email or push.
 */
export const NOTIFICATION_TEMPLATES = [
  "receipt_available",
  "request_decision",
  "document_rejected",
  "contract_ending",
  "request_pending",
] as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

/** in_app is the inbox row itself and cannot be turned off; email and push can. */
export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const OPTIONAL_NOTIFICATION_CHANNELS = ["email", "push"] as const;

export type OptionalNotificationChannel =
  (typeof OPTIONAL_NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;

export type NotificationDeliveryStatus =
  (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

const oneRecipient = (personId: unknown, userId: unknown) =>
  sql`(${personId} IS NULL) <> (${userId} IS NULL)`;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    recipientPersonId: uuid("recipient_person_id"),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    template: text("template").$type<NotificationTemplate>().notNull(),
    /** Rendered once, when created, so the inbox reads the same years later. */
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** An app path (never an external URL) the message opens. */
    url: text("url"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** Idempotency: the same event for the same recipient creates one message. */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    unique("notifications_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "notifications_company_person_fk",
      columns: [table.companyId, table.recipientPersonId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    // The two inboxes, newest first, read with a (created_at, id) keyset.
    index("notifications_person_inbox_idx")
      .on(
        table.companyId,
        table.recipientPersonId,
        table.createdAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.recipientPersonId} IS NOT NULL`),
    index("notifications_user_inbox_idx")
      .on(
        table.companyId,
        table.recipientUserId,
        table.createdAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.recipientUserId} IS NOT NULL`),
    uniqueIndex("notifications_dedupe_unique")
      .on(table.companyId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    // The retention job deletes by age.
    index("notifications_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    check(
      "notifications_one_recipient_check",
      oneRecipient(table.recipientPersonId, table.recipientUserId),
    ),
    check(
      "notifications_template_check",
      sql`${table.template} IN (${inList(NOTIFICATION_TEMPLATES)})`,
    ),
    check(
      "notifications_url_check",
      sql`${table.url} IS NULL OR (${table.url} LIKE '/%' AND ${table.url} NOT LIKE '//%')`,
    ),
  ],
);

/**
 * The delivery log: one row per notification and channel. in_app is written
 * as sent with the notification; email and push start pending and are sent
 * after the commit, retried with backoff until sent or failed. skipped says
 * why nothing went out (opted out, no address, no device, not configured).
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel").$type<NotificationChannel>().notNull(),
    status: text("status").$type<NotificationDeliveryStatus>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** When a pending delivery is due; a claimed one is pushed ahead as a lease. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "notification_deliveries_company_notification_fk",
      columns: [table.companyId, table.notificationId],
      foreignColumns: [notifications.companyId, notifications.id],
    }).onDelete("cascade"),
    uniqueIndex("notification_deliveries_notification_channel_unique").on(
      table.notificationId,
      table.channel,
    ),
    // What the sender picks up next: due pending rows, oldest first.
    index("notification_deliveries_due_idx")
      .on(table.companyId, table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      "notification_deliveries_channel_check",
      sql`${table.channel} IN (${inList(NOTIFICATION_CHANNELS)})`,
    ),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} IN (${inList(NOTIFICATION_DELIVERY_STATUSES)})`,
    ),
    check(
      "notification_deliveries_pending_check",
      sql`(${table.status} = 'pending') = (${table.nextAttemptAt} IS NOT NULL)`,
    ),
    check(
      "notification_deliveries_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
  ],
);

/**
 * A phone or browser that accepted web push for a person in the employee app.
 * The endpoint and keys come from the browser's PushManager; a 404 or 410
 * from the push service deletes the row.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "push_subscriptions_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    uniqueIndex("push_subscriptions_company_endpoint_unique").on(
      table.companyId,
      table.endpoint,
    ),
    index("push_subscriptions_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "push_subscriptions_endpoint_check",
      sql`${table.endpoint} LIKE 'https://%'`,
    ),
  ],
);

/** Opt-outs per recipient and channel. No row means the channel is on. */
export const notificationOptOuts = pgTable(
  "notification_opt_outs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    recipientPersonId: uuid("recipient_person_id"),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    channel: text("channel").$type<OptionalNotificationChannel>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "notification_opt_outs_company_person_fk",
      columns: [table.companyId, table.recipientPersonId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    uniqueIndex("notification_opt_outs_person_channel_unique")
      .on(table.companyId, table.recipientPersonId, table.channel)
      .where(sql`${table.recipientPersonId} IS NOT NULL`),
    uniqueIndex("notification_opt_outs_user_channel_unique")
      .on(table.companyId, table.recipientUserId, table.channel)
      .where(sql`${table.recipientUserId} IS NOT NULL`),
    check(
      "notification_opt_outs_one_recipient_check",
      oneRecipient(table.recipientPersonId, table.recipientUserId),
    ),
    check(
      "notification_opt_outs_channel_check",
      sql`${table.channel} IN (${inList(OPTIONAL_NOTIFICATION_CHANNELS)})`,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
