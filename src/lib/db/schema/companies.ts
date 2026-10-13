import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { roles, users } from "./rbac";

// Row-level security per company lives in migration 0018 (SQL), not here:
// drizzle-kit renders pgPolicy without its USING/WITH CHECK clauses. The
// database test company-rls.db.test.ts fails if a table with company_id lacks it.

export const companyStatusEnum = pgEnum("company_status", [
  "activa",
  "suspendida",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "activa",
  "revocada",
]);

/** A tenant. Every business row belongs to exactly one company. */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Nombre comercial, shown in the app. */
    name: text("name").notNull(),
    /** Razón social. */
    legalName: text("legal_name"),
    rfc: text("rfc"),
    slug: text("slug").notNull(),
    status: companyStatusEnum("status").notNull().default("activa"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("companies_slug_unique").on(table.slug)],
);

/** A user's access to one company, with the role they have there. */
export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: membershipStatusEnum("status").notNull().default("activa"),
    /** The company the user lands in after signing in. */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("company_memberships_user_company_unique").on(
      table.userId,
      table.companyId,
    ),
    uniqueIndex("company_memberships_user_default_unique")
      .on(table.userId)
      .where(sql`${table.isDefault}`),
    index("company_memberships_company_id_idx").on(table.companyId),
    index("company_memberships_role_id_idx").on(table.roleId),
  ],
);

export const companiesRelations = relations(companies, ({ many }) => ({
  memberships: many(companyMemberships),
}));

export const companyMembershipsRelations = relations(
  companyMemberships,
  ({ one }) => ({
    user: one(users, {
      fields: [companyMemberships.userId],
      references: [users.id],
    }),
    company: one(companies, {
      fields: [companyMemberships.companyId],
      references: [companies.id],
    }),
    role: one(roles, {
      fields: [companyMemberships.roleId],
      references: [roles.id],
    }),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyStatus = (typeof companyStatusEnum.enumValues)[number];
export type CompanyMembership = typeof companyMemberships.$inferSelect;
export type MembershipStatus = (typeof membershipStatusEnum.enumValues)[number];
