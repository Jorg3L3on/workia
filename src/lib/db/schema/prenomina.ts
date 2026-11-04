import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { users } from "./rbac";

/**
 * How one payroll provider wants the pre-nómina file (Workia 2.0 W2-18), per
 * company. The provider is not chosen yet, so a template only describes a
 * shape (src/lib/prenomina/template.ts validates it): CSV or Excel, one row
 * per person ("wide") or per person and concept ("long"), the columns in
 * order, the provider's concept codes and the CSV details. Archived, never
 * deleted; who changed it is in audit_events.
 */
export const prenominaTemplates = pgTable(
  "prenomina_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    format: text("format").$type<"csv" | "xlsx">().notNull(),
    layout: text("layout").$type<"wide" | "long">().notNull(),
    delimiter: text("delimiter").notNull().default(","),
    encoding: text("encoding").notNull().default("utf8_bom"),
    dateFormat: text("date_format").notNull().default("iso"),
    includeHeader: boolean("include_header").notNull().default(true),
    skipEmpty: boolean("skip_empty").notNull().default(true),
    columns: jsonb("columns")
      .$type<Array<{ header: string; field: string; value?: string }>>()
      .notNull(),
    conceptCodes: jsonb("concept_codes")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("prenomina_templates_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    uniqueIndex("prenomina_templates_company_name_active_unique")
      .on(table.companyId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    check(
      "prenomina_templates_name_check",
      sql`char_length(${table.name}) BETWEEN 1 AND 80`,
    ),
    check(
      "prenomina_templates_format_check",
      sql`${table.format} IN ('csv', 'xlsx')`,
    ),
    check(
      "prenomina_templates_layout_check",
      sql`${table.layout} IN ('wide', 'long')`,
    ),
    check(
      "prenomina_templates_delimiter_check",
      sql`${table.delimiter} IN (',', ';', '|', E'\\t')`,
    ),
    check(
      "prenomina_templates_encoding_check",
      sql`${table.encoding} IN ('utf8_bom', 'utf8', 'latin1')`,
    ),
    check(
      "prenomina_templates_date_format_check",
      sql`${table.dateFormat} IN ('iso', 'dmy', 'dmy_dash', 'ymd_compact')`,
    ),
    check(
      "prenomina_templates_columns_check",
      sql`jsonb_typeof(${table.columns}) = 'array' AND jsonb_array_length(${table.columns}) BETWEEN 1 AND 60 AND pg_column_size(${table.columns}) <= 16384`,
    ),
    check(
      "prenomina_templates_concept_codes_check",
      sql`jsonb_typeof(${table.conceptCodes}) = 'object' AND pg_column_size(${table.conceptCodes}) <= 4096`,
    ),
  ],
);

export type PrenominaTemplateRow = typeof prenominaTemplates.$inferSelect;
