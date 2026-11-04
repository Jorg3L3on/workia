import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";

/** What happened to the person (Workia 2.0 P-01). Who did it stays in audit_events. */
export const personEventTypeEnum = pgEnum("person_event_type", [
  "attendance",
  "incidencia",
  "vacation",
  "receipt",
  "document",
  "employment",
]);

/**
 * The person timeline: one append-only row per event about a person, keyed by
 * (company_id, person_id) like every business table, with no CURP and no
 * account id. Attendance is one row per person per day: its dedupe key is
 * 'attendance:<date>', unique per person. Not partitioned. Rows leave only by the retention job
 * or when the person row is hard-deleted.
 */
export const personEvents = pgTable(
  "person_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    type: personEventTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    dedupeKey: text("dedupe_key"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    foreignKey({
      name: "person_events_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    // One person's history in time order: one index range scan. `id` breaks
    // ties so keyset pages never skip or repeat a row.
    index("person_events_person_time_idx").on(
      table.companyId,
      table.personId,
      table.occurredAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // The today view: attendance and incidencias of one site.
    index("person_events_site_day_idx")
      .on(
        table.companyId,
        sql`(${table.payload} ->> 'site_id')`,
        table.occurredAt,
      )
      .where(sql`${table.type} in ('attendance', 'incidencia')`),
    // Idempotent ingestion: a key is written once per person. Person ids are
    // unique across companies, so the company adds nothing but bytes here.
    uniqueIndex("person_events_dedupe_unique")
      .on(table.personId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    check(
      "person_events_attendance_dedupe_check",
      sql`${table.type} <> 'attendance' OR (${table.dedupeKey} IS NOT NULL AND ${table.dedupeKey} ~ '^attendance:[0-9]{4}-[0-9]{2}-[0-9]{2}$')`,
    ),
    check(
      "person_events_source_check",
      sql`char_length(${table.source}) BETWEEN 1 AND 64`,
    ),
    check(
      "person_events_dedupe_key_check",
      sql`${table.dedupeKey} IS NULL OR char_length(${table.dedupeKey}) BETWEEN 1 AND 200`,
    ),
    check(
      "person_events_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object' AND pg_column_size(${table.payload}) <= 4096`,
    ),
  ],
);

export type PersonEvent = typeof personEvents.$inferSelect;
export type NewPersonEvent = typeof personEvents.$inferInsert;
export type PersonEventType = (typeof personEventTypeEnum.enumValues)[number];
