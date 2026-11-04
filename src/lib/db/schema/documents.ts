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
import { employeeAccounts } from "./employee-accounts";
import { people } from "./people";
import { users } from "./rbac";
import {
  DOCUMENT_REJECTION_REASONS,
  PERSON_DOCUMENT_STATUSES,
} from "./document-review";

export * from "./document-review";

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
 *
 * W2-04 adds the file an employee uploads (file_key in object storage, never
 * the bytes) and HR's review. Only accepted rows count as deliveries.
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
    status: text("status", { enum: PERSON_DOCUMENT_STATUSES })
      .notNull()
      .default("accepted"),
    fileKey: text("file_key"),
    fileContentType: text("file_content_type"),
    fileSize: integer("file_size"),
    uploadedByAccountId: uuid("uploaded_by_account_id"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason", {
      enum: DOCUMENT_REJECTION_REASONS,
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
    // ON DELETE SET NULL (uploaded_by_account_id) is in 0043 by hand.
    foreignKey({
      name: "person_documents_company_uploaded_by_fk",
      columns: [table.companyId, table.uploadedByAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }),
    index("person_documents_review_queue_idx")
      .on(table.companyId, table.createdAt, table.id)
      .where(sql`${table.status} = 'uploaded'`),
    uniqueIndex("person_documents_one_pending_unique")
      .on(table.companyId, table.personId, table.requirementId)
      .where(sql`${table.status} = 'uploaded'`),
    check(
      "person_documents_status_check",
      sql`${table.status} IN ('uploaded', 'accepted', 'rejected')`,
    ),
    check(
      "person_documents_file_check",
      sql`(${table.fileKey} IS NULL) = (${table.fileContentType} IS NULL) AND (${table.fileKey} IS NULL) = (${table.fileSize} IS NULL) AND (${table.fileSize} IS NULL OR ${table.fileSize} > 0) AND (${table.status} <> 'uploaded' OR ${table.fileKey} IS NOT NULL) AND (${table.status} <> 'rejected' OR ${table.fileKey} IS NULL)`,
    ),
    check(
      "person_documents_rejection_check",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL) AND (${table.rejectionReason} IS NULL OR ${table.rejectionReason} IN ('illegible', 'wrong_document', 'expired', 'incomplete', 'wrong_person'))`,
    ),
    check(
      "person_documents_review_check",
      sql`(${table.status} <> 'uploaded' OR ${table.reviewedAt} IS NULL) AND (${table.status} <> 'rejected' OR ${table.reviewedAt} IS NOT NULL)`,
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
