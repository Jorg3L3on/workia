import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";

/**
 * A company's pay period (Workia 2.0 P-02). Every company pays quincenal, so
 * `period` is 'YYYY-MM-Q1' (days 1 to 15) or 'YYYY-MM-Q2' (16 to the end of
 * the month) and the dates are derived from it. `revision` counts the closes:
 * a reopen and a new close give revision 2. Who closed or reopened it, and
 * why, is in audit_events.
 */
export const payPeriods = pgTable(
  "pay_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [
    unique("pay_periods_company_id_id_unique").on(table.companyId, table.id),
    unique("pay_periods_company_period_unique").on(
      table.companyId,
      table.period,
    ),
    check(
      "pay_periods_period_check",
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-Q[12]$'`,
    ),
    check("pay_periods_dates_check", sql`${table.endsOn} >= ${table.startsOn}`),
    check(
      "pay_periods_status_check",
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL) OR (${table.status} = 'closed' AND ${table.closedAt} IS NOT NULL)`,
    ),
    check("pay_periods_revision_check", sql`${table.revision} >= 0`),
  ],
);

/**
 * The incidencias of a closed pay period, frozen in the same transaction as
 * the close: one row per person and incidencia kind. Pre-nómina reads this,
 * never the live aggregates. A person without incidencias has no row. A
 * reopen deletes the rows; the next close writes them again.
 */
export const incidenciasPeriodSnapshot = pgTable(
  "incidencias_period_snapshot",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    payPeriodId: uuid("pay_period_id").notNull(),
    personId: uuid("person_id").notNull(),
    kind: text("kind").notNull(),
    /** Days with this incidencia in the period. */
    count: integer("count").notNull(),
    /** Of those, how many were justified. */
    justified: integer("justified").notNull(),
    /** Minutes added up (retardo, salida anticipada); 0 for a falta. */
    minutes: integer("minutes").notNull(),
  },
  (table) => [
    // Reading a period is a range scan of this key.
    primaryKey({
      name: "incidencias_period_snapshot_pkey",
      columns: [table.payPeriodId, table.personId, table.kind],
    }),
    foreignKey({
      name: "incidencias_period_snapshot_company_period_fk",
      columns: [table.companyId, table.payPeriodId],
      foreignColumns: [payPeriods.companyId, payPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "incidencias_period_snapshot_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    check(
      "incidencias_period_snapshot_kind_check",
      sql`char_length(${table.kind}) BETWEEN 1 AND 32`,
    ),
    check(
      "incidencias_period_snapshot_counts_check",
      sql`${table.count} > 0 AND ${table.justified} BETWEEN 0 AND ${table.count} AND ${table.minutes} >= 0`,
    ),
  ],
);

export type PayPeriod = typeof payPeriods.$inferSelect;
export type IncidenciasPeriodSnapshotRow =
  typeof incidenciasPeriodSnapshot.$inferSelect;
