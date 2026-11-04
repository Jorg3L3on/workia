import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employeeAccounts } from "./employee-accounts";
import { people } from "./people";
import { users } from "./rbac";
import { vacationRecords } from "./vacations";

/** What an employee asks for (Workia 2.0 W2-06). Home office and shift swaps are out of scope. */
export const timeOffKindEnum = pgEnum("time_off_kind", [
  "vacaciones",
  "permiso_con_goce",
  "permiso_sin_goce",
]);

/**
 * pending → approved | rejected | cancelled; approved → cancelled (only
 * before the first day). Every transition is an audit event and a
 * person_events row, in the same transaction.
 */
export const timeOffStatusEnum = pgEnum("time_off_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * Requests for vacaciones and permisos, and their decisions (Workia 2.0
 * W2-06, docs/solicitudes.md). Days only, never amounts. `manager_id` is the
 * approver stored when the request is created (currentApprover of W2-07);
 * null means HR decides. A later change of jefe does not move a pending
 * request. An approved vacation points to the vacation_records row it wrote.
 */
export const timeOffRequests = pgTable(
  "time_off_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    kind: timeOffKindEnum("kind").notNull(),
    status: timeOffStatusEnum("status").notNull().default("pending"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Half-day steps, as vacation_records.days. */
    days: numeric("days", { precision: 4, scale: 1 }).notNull(),
    /** The employee's note. Optional and short: it can carry health data, so it is shown only to the approver and HR. */
    note: text("note"),
    /** The approver person (their jefe with a live manager grant), or null for HR. */
    managerId: uuid("manager_id"),
    /** The employee account that sent it. */
    requestedByAccountId: uuid("requested_by_account_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** A manager (or their backup) deciding from the employee app. */
    decidedByAccountId: uuid("decided_by_account_id"),
    /** HR deciding from the HR app. */
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Required on a rejection. */
    decisionReason: text("decision_reason"),
    vacationRecordId: uuid("vacation_record_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("time_off_requests_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "time_off_requests_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "time_off_requests_company_manager_fk",
      columns: [table.companyId, table.managerId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("set null"),
    foreignKey({
      name: "time_off_requests_company_requested_by_fk",
      columns: [table.companyId, table.requestedByAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "time_off_requests_company_decided_by_fk",
      columns: [table.companyId, table.decidedByAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "time_off_requests_company_vacation_record_fk",
      columns: [table.companyId, table.vacationRecordId],
      foreignColumns: [vacationRecords.companyId, vacationRecords.id],
    }).onDelete("set null"),
    // The approvals inbox (docs/keyset.md): approver and status by equality,
    // then the keyset, so a page is one range scan with no sort. HR's queue is
    // the same index with manager_id IS NULL.
    index("time_off_requests_inbox_idx").on(
      table.companyId,
      table.managerId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    // «Mis solicitudes» and the overlap check of one person.
    index("time_off_requests_person_idx").on(
      table.companyId,
      table.personId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "time_off_requests_dates_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "time_off_requests_days_check",
      sql`${table.days} > 0 AND ${table.days} * 2 = trunc(${table.days} * 2)`,
    ),
    check(
      "time_off_requests_note_check",
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 280`,
    ),
    check(
      "time_off_requests_reason_check",
      sql`${table.decisionReason} IS NULL OR char_length(${table.decisionReason}) <= 280`,
    ),
    check(
      "time_off_requests_decision_check",
      sql`(${table.status} = 'pending' AND ${table.decidedAt} IS NULL) OR (${table.status} = 'cancelled') OR (${table.status} IN ('approved', 'rejected') AND ${table.decidedAt} IS NOT NULL)`,
    ),
    check(
      "time_off_requests_rejection_reason_check",
      sql`${table.status} <> 'rejected' OR ${table.decisionReason} IS NOT NULL`,
    ),
    check(
      "time_off_requests_vacation_record_check",
      sql`${table.vacationRecordId} IS NULL OR ${table.kind} = 'vacaciones'`,
    ),
    check(
      "time_off_requests_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} IS NOT NULL)`,
    ),
  ],
);

export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type TimeOffKind = (typeof timeOffKindEnum.enumValues)[number];
export type TimeOffStatus = (typeof timeOffStatusEnum.enumValues)[number];
