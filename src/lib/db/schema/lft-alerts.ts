import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";

/**
 * LFT alerts (Workia 2.0 W2-19, docs/alertas-lft.md): what Workia warned HR
 * and the manager about, so the warning is on record after the inbox
 * message is gone. One row per alert; the same fact (subject_key) is alerted
 * once. Append-only: the app role can insert and read, never change one.
 */
export const LFT_ALERT_KINDS = [
  "absence_warning",
  "absence_threshold",
  "contract_ending",
  "document_expiring",
] as const;

export type LftAlertKind = (typeof LFT_ALERT_KINDS)[number];

export const lftAlerts = pgTable(
  "lft_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    kind: text("kind").$type<LftAlertKind>().notNull(),
    /** The fact alerted: `<trigger day>` for absences, `<contract id>:<end date>`, `<document id>:<expiry>`. */
    subjectKey: text("subject_key").notNull(),
    /** The falta that reached the count, the contract's end date or the document's expiry. */
    dueOn: date("due_on").notNull(),
    /** Absences: count, window from/to and the days counted. Others: names shown. */
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** HR users the alert went to. */
    hrRecipients: smallint("hr_recipients").notNull().default(0),
    /** Whether the person's live manager got it too. */
    managerNotified: boolean("manager_notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "lft_alerts_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    unique("lft_alerts_subject_key").on(
      table.companyId,
      table.kind,
      table.subjectKey,
    ),
    // The log page: newest first, keyset.
    index("lft_alerts_company_created_idx").on(
      table.companyId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    // The absence check reads each person's recent alerts.
    index("lft_alerts_company_person_kind_due_idx").on(
      table.companyId,
      table.personId,
      table.kind,
      table.dueOn,
    ),
    check(
      "lft_alerts_kind_check",
      sql`${table.kind} IN ('absence_warning', 'absence_threshold', 'contract_ending', 'document_expiring')`,
    ),
    check(
      "lft_alerts_subject_key_check",
      sql`char_length(${table.subjectKey}) BETWEEN 1 AND 120`,
    ),
    check("lft_alerts_hr_recipients_check", sql`${table.hrRecipients} >= 0`),
  ],
);

/**
 * When the alert check last ran for a company: the HR home runs it at most
 * once in ALERT_RUN_INTERVAL_HOURS, so no cron is needed.
 */
export const lftAlertRuns = pgTable("lft_alert_runs", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

export type LftAlert = typeof lftAlerts.$inferSelect;
