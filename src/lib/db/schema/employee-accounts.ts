import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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
 * Employee accounts (Workia 2.0 W2-01, docs/identity-model.md): how a person
 * signs in to see their own record. One account points at one people row of
 * one company. HR invites, the employee activates, a baja or a borrado
 * disables. A disabled account is kept for the audit trail and never comes
 * back: a rehire gets a new invitation.
 *
 * Sign-in finds an account before a company is known; the SQL function
 * employee_credential_company() (migration 0030) answers only «which company
 * holds this email, CURP or session», so every read after it runs under RLS.
 */
export const EMPLOYEE_ACCOUNT_STATUSES = [
  "invited",
  "active",
  "disabled",
] as const;

export type EmployeeAccountStatus = (typeof EMPLOYEE_ACCOUNT_STATUSES)[number];

/** Why an account was disabled: the person's baja, their borrado, or HR. */
export const EMPLOYEE_DISABLED_REASONS = ["baja", "borrado", "rrhh"] as const;

export type EmployeeDisabledReason = (typeof EMPLOYEE_DISABLED_REASONS)[number];

export const employeeAccounts = pgTable(
  "employee_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    status: text("status")
      .$type<EmployeeAccountStatus>()
      .notNull()
      .default("invited"),
    /** Normalized (trimmed, lower case). Where the invitation went; verified once a code sent to it is used. */
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Only for people who activate with an HR code: they sign in with CURP and password. */
    passwordHash: text("password_hash"),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason").$type<EmployeeDisabledReason>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("employee_accounts_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "employee_accounts_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    // At most one live account per person.
    uniqueIndex("employee_accounts_person_live_unique")
      .on(table.companyId, table.personId)
      .where(sql`${table.status} <> 'disabled'`),
    // Sign-in by email resolves to one account, across every company.
    uniqueIndex("employee_accounts_email_live_unique")
      .on(table.email)
      .where(sql`${table.status} <> 'disabled' AND ${table.email} IS NOT NULL`),
    index("employee_accounts_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "employee_accounts_status_check",
      sql`${table.status} IN ('invited', 'active', 'disabled')`,
    ),
    check(
      "employee_accounts_disabled_check",
      sql`(${table.status} = 'disabled') = (${table.disabledAt} IS NOT NULL)`,
    ),
    check(
      "employee_accounts_disabled_reason_check",
      sql`${table.disabledReason} IS NULL OR ${table.disabledReason} IN ('baja', 'borrado', 'rrhh')`,
    ),
    check(
      "employee_accounts_email_check",
      sql`${table.email} IS NULL OR (${table.email} = lower(btrim(${table.email})) AND ${table.email} LIKE '%_@_%')`,
    ),
  ],
);

/**
 * A signed-in employee: a random token in their cookie, its HMAC here, so a
 * baja can delete the session the same day. Not the Auth.js HR session.
 */
export const employeeSessions = pgTable(
  "employee_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "employee_sessions_company_account_fk",
      columns: [table.companyId, table.accountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    uniqueIndex("employee_sessions_token_hash_unique").on(table.tokenHash),
    index("employee_sessions_company_account_idx").on(
      table.companyId,
      table.accountId,
    ),
    index("employee_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const EMPLOYEE_CODE_PURPOSES = ["login", "activation"] as const;

export type EmployeeCodePurpose = (typeof EMPLOYEE_CODE_PURPOSES)[number];

/**
 * One-time codes: «login» goes by email (six digits, minutes), «activation»
 * is issued by HR for a person without email (days). Stored as an HMAC, with
 * an expiry and an attempt counter; used_at makes them single use.
 */
export const employeeCodes = pgTable(
  "employee_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    purpose: text("purpose").$type<EmployeeCodePurpose>().notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "employee_codes_company_account_fk",
      columns: [table.companyId, table.accountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("cascade"),
    index("employee_codes_company_account_purpose_idx").on(
      table.companyId,
      table.accountId,
      table.purpose,
    ),
    index("employee_codes_expires_at_idx").on(table.expiresAt),
    check(
      "employee_codes_purpose_check",
      sql`${table.purpose} IN ('login', 'activation')`,
    ),
    check("employee_codes_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export type EmployeeAccount = typeof employeeAccounts.$inferSelect;
export type EmployeeSession = typeof employeeSessions.$inferSelect;
export type EmployeeCode = typeof employeeCodes.$inferSelect;
