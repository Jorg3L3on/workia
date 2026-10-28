import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employmentPeriods } from "./employment";
import { people } from "./people";
import { users } from "./rbac";

/**
 * Days already taken (WRK-I14-3). `days` is the amount HR typed, in half-day
 * steps. `voided_at` retires a row; the app never deletes one.
 */
export const vacationRecords = pgTable(
  "vacation_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    employmentPeriodId: uuid("employment_period_id"),
    serviceYear: integer("service_year").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: numeric("days", { precision: 4, scale: 1 }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (table) => [
    unique("vacation_records_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "vacation_records_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "vacation_records_company_period_fk",
      columns: [table.companyId, table.employmentPeriodId],
      foreignColumns: [employmentPeriods.companyId, employmentPeriods.id],
    }).onDelete("set null"),
    index("vacation_records_company_person_start_idx").on(
      table.companyId,
      table.personId,
      table.startDate,
    ),
    check(
      "vacation_records_dates_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "vacation_records_days_check",
      sql`${table.days} > 0 AND ${table.days} <= 999.9 AND ${table.days} = trunc(${table.days} * 2) / 2`,
    ),
    check(
      "vacation_records_service_year_check",
      sql`${table.serviceYear} >= 0`,
    ),
    check(
      "vacation_records_note_check",
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 280`,
    ),
  ],
);

export type VacationRecord = typeof vacationRecords.$inferSelect;
