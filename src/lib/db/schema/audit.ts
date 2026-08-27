import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./rbac";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    result: text("result").notNull().default("success"),
    source: text("source").notNull().default("app"),
    payload: jsonb("payload"),
    requestMeta: jsonb("request_meta"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_occurred_at_idx").on(table.occurredAt),
    index("audit_events_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_events_actor_user_id_idx").on(table.actorUserId),
  ],
);

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(users, {
    fields: [auditEvents.actorUserId],
    references: [users.id],
  }),
}));

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
