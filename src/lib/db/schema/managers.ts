import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employeeAccounts } from "./employee-accounts";
import { users } from "./rbac";

/**
 * Manager scope (Workia 2.0 W2-07, docs/managers.md): HR's grant that lets an
 * employee account open «Mi equipo». The team itself is never stored: it is
 * read live from people.manager_id on every request, so changing a person's
 * jefe moves them on the next request. One live grant per account; revoking
 * keeps the row for the audit trail.
 */
export const managerGrants = pgTable(
  "manager_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    /** Reports of reports too (a recursive read of people.manager_id). Off unless HR enables it. */
    includeIndirect: boolean("include_indirect").notNull().default(false),
    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique("manager_grants_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "manager_grants_company_account_fk",
      columns: [table.companyId, table.accountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    uniqueIndex("manager_grants_account_live_unique")
      .on(table.companyId, table.accountId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * A backup manager during an absence: the delegate acts for the manager's
 * team and inbox from starts_on to ends_on (Mexico dates, both included).
 * It needs the manager's grant to be live; it does not chain (a delegate's
 * own delegations never pass the manager's team on).
 */
export const managerDelegations = pgTable(
  "manager_delegations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    managerAccountId: uuid("manager_account_id").notNull(),
    delegateAccountId: uuid("delegate_account_id").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** HR when it was set up from the expediente; null when the manager did it from /mi. */
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    foreignKey({
      name: "manager_delegations_company_manager_fk",
      columns: [table.companyId, table.managerAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "manager_delegations_company_delegate_fk",
      columns: [table.companyId, table.delegateAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    index("manager_delegations_delegate_live_idx")
      .on(table.companyId, table.delegateAccountId, table.endsOn)
      .where(sql`${table.revokedAt} IS NULL`),
    index("manager_delegations_manager_live_idx")
      .on(table.companyId, table.managerAccountId, table.endsOn)
      .where(sql`${table.revokedAt} IS NULL`),
    check(
      "manager_delegations_dates_check",
      sql`${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      "manager_delegations_not_self_check",
      sql`${table.managerAccountId} <> ${table.delegateAccountId}`,
    ),
  ],
);

export type ManagerGrant = typeof managerGrants.$inferSelect;
export type ManagerDelegation = typeof managerDelegations.$inferSelect;
