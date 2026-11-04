import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employeeAccounts } from "./employee-accounts";
import { people } from "./people";
import { users } from "./rbac";

/**
 * Correction requests from Mi expediente (Workia 2.0 W2-02,
 * docs/mi-expediente.md). The employee never edits their record: they say
 * which field is wrong and what it should say, and the request waits in HR's
 * «Correcciones» inbox with the value it had when they asked (before) and the
 * proposed one (after). HR fixes the record in the person form, then marks the
 * request applied, or rejects it with a reason. The employee can cancel a
 * pending one.
 */
export const PROFILE_CORRECTION_STATUSES = [
  "pendiente",
  "aplicada",
  "rechazada",
  "cancelada",
] as const;

export type ProfileCorrectionStatus =
  (typeof PROFILE_CORRECTION_STATUSES)[number];

export const profileCorrections = pgTable(
  "profile_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    /** The employee account that asked (always the person's own). */
    accountId: uuid("account_id").notNull(),
    /** A key of EXPEDIENTE_FIELDS (src/lib/profile-corrections/fields.ts). */
    field: text("field").notNull(),
    /** What the expediente showed when the employee asked; null when empty. */
    currentValue: text("current_value"),
    proposedValue: text("proposed_value").notNull(),
    /** The employee's comment, optional. */
    note: text("note"),
    status: text("status")
      .$type<ProfileCorrectionStatus>()
      .notNull()
      .default("pendiente"),
    /** HR user who applied or rejected it; null while pending or when cancelled. */
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** When it left «pendiente» (applied, rejected or cancelled). */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Why HR rejected it: required on «rechazada», shown to the employee. */
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("profile_corrections_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "profile_corrections_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "profile_corrections_company_account_fk",
      columns: [table.companyId, table.accountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    // One pending request per field and person: a second one is refused.
    uniqueIndex("profile_corrections_pending_field_unique")
      .on(table.companyId, table.personId, table.field)
      .where(sql`${table.status} = 'pendiente'`),
    // HR's inbox: a company's pending requests, oldest first (keyset).
    index("profile_corrections_inbox_idx")
      .on(table.companyId, table.createdAt, table.id)
      .where(sql`${table.status} = 'pendiente'`),
    // The employee's own requests, newest first.
    index("profile_corrections_company_person_idx").on(
      table.companyId,
      table.personId,
      table.createdAt,
    ),
    check(
      "profile_corrections_status_check",
      sql`${table.status} IN ('pendiente', 'aplicada', 'rechazada', 'cancelada')`,
    ),
    check(
      "profile_corrections_field_check",
      sql`${table.field} ~ '^[a-zA-Z]{1,40}$'`,
    ),
    check(
      "profile_corrections_proposed_value_check",
      sql`length(btrim(${table.proposedValue})) BETWEEN 1 AND 300`,
    ),
    check(
      "profile_corrections_note_check",
      sql`${table.note} IS NULL OR length(${table.note}) <= 500`,
    ),
    check(
      "profile_corrections_decided_check",
      sql`(${table.status} = 'pendiente') = (${table.decidedAt} IS NULL)`,
    ),
    check(
      "profile_corrections_reason_check",
      sql`(${table.status} <> 'rechazada' OR length(btrim(coalesce(${table.decisionReason}, ''))) > 0) AND (${table.decisionReason} IS NULL OR length(${table.decisionReason}) <= 500)`,
    ),
  ],
);

export type ProfileCorrection = typeof profileCorrections.$inferSelect;
