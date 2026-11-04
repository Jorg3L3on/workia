import {
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companies } from "./companies";
import { employmentPeriods } from "./employment";
import { people } from "./people";
import { users } from "./rbac";

/** Which side of a transfer a link row is: the row the person left, or the one they arrived at. */
export const personLinkDirectionEnum = pgEnum("person_link_direction", [
  "out",
  "in",
]);

/**
 * A transfer between subsidiaries links two people rows by id (Workia 2.0
 * W2-24, migration 0046, docs/transfers.md). One transfer is two rows, one in
 * each company, sharing `transfer_id`: each company sees its own side under
 * its own row-level security and learns the other side's ids, never its
 * data. The CURP of both rows must match; the transfer flow checks it, and
 * the row stores no CURP. Rows are never updated.
 */
export const personLinks = pgTable(
  "person_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    linkedCompanyId: uuid("linked_company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    linkedPersonId: uuid("linked_person_id").notNull(),
    /** The same on both sides of one transfer. */
    transferId: uuid("transfer_id").notNull(),
    direction: personLinkDirectionEnum("direction").notNull(),
    /** First day in the new company; the old period closed the day before. */
    transferDate: date("transfer_date").notNull(),
    /** This side's period: the one the transfer closed (out) or opened (in). */
    employmentPeriodId: uuid("employment_period_id").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "person_links_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "person_links_linked_person_fk",
      columns: [table.linkedCompanyId, table.linkedPersonId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "person_links_company_period_fk",
      columns: [table.companyId, table.employmentPeriodId],
      foreignColumns: [employmentPeriods.companyId, employmentPeriods.id],
    }).onDelete("cascade"),
    unique("person_links_transfer_company_unique").on(
      table.transferId,
      table.companyId,
    ),
    // A period is opened by at most one transfer and closed by at most one.
    unique("person_links_period_unique").on(
      table.companyId,
      table.employmentPeriodId,
      table.direction,
    ),
    index("person_links_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "person_links_other_company_check",
      sql`${table.companyId} <> ${table.linkedCompanyId}`,
    ),
  ],
);

export type PersonLink = typeof personLinks.$inferSelect;
export type PersonLinkDirection =
  (typeof personLinkDirectionEnum.enumValues)[number];
