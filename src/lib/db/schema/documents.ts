import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { positions } from "./catalog";
import { companies } from "./companies";
import { people } from "./people";
import { users } from "./rbac";

/** catalog_key(name): the importer's catalogKey() in SQL (migration 0017). */
const catalogKeyOf = (column: AnyPgColumn) => sql`catalog_key(${column})`;

/**
 * Papers a company asks for (WRK-I15-1). position_id null means every
 * position. Names only: no files, no document numbers, no free-text note.
 */
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    positionId: uuid("position_id"),
    name: text("name").notNull(),
    required: boolean("required").notNull().default(true),
    validityMonths: integer("validity_months"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("document_requirements_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "document_requirements_company_position_fk",
      columns: [table.companyId, table.positionId],
      foreignColumns: [positions.companyId, positions.id],
    }).onDelete("restrict"),
    uniqueIndex("document_requirements_position_name_active_unique")
      .on(table.companyId, table.positionId, catalogKeyOf(table.name))
      .where(
        sql`${table.deletedAt} is null and ${table.positionId} is not null`,
      ),
    uniqueIndex("document_requirements_company_name_active_unique")
      .on(table.companyId, catalogKeyOf(table.name))
      .where(sql`${table.deletedAt} is null and ${table.positionId} is null`),
    check(
      "document_requirements_validity_months_check",
      sql`${table.validityMonths} IS NULL OR ${table.validityMonths} > 0`,
    ),
  ],
);

/**
 * One delivery of a requirement by a person: the date it was handed in and,
 * when it expires, that date. No note, result or observation column.
 */
export const personDocuments = pgTable(
  "person_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    requirementId: uuid("requirement_id").notNull(),
    deliveredOn: date("delivered_on").notNull(),
    expiresOn: date("expires_on"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("person_documents_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "person_documents_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "person_documents_company_requirement_fk",
      columns: [table.companyId, table.requirementId],
      foreignColumns: [documentRequirements.companyId, documentRequirements.id],
    }).onDelete("restrict"),
    index("person_documents_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    index("person_documents_company_expires_on_idx").on(
      table.companyId,
      table.expiresOn,
    ),
    check(
      "person_documents_dates_check",
      sql`${table.expiresOn} IS NULL OR ${table.expiresOn} >= ${table.deliveredOn}`,
    ),
  ],
);

export const documentRequirementsRelations = relations(
  documentRequirements,
  ({ one, many }) => ({
    position: one(positions, {
      fields: [documentRequirements.positionId],
      references: [positions.id],
    }),
    documents: many(personDocuments),
  }),
);

export const personDocumentsRelations = relations(
  personDocuments,
  ({ one }) => ({
    person: one(people, {
      fields: [personDocuments.personId],
      references: [people.id],
    }),
    requirement: one(documentRequirements, {
      fields: [personDocuments.requirementId],
      references: [documentRequirements.id],
    }),
  }),
);

export type DocumentRequirement = typeof documentRequirements.$inferSelect;
export type PersonDocument = typeof personDocuments.$inferSelect;
