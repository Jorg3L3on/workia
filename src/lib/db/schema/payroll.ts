import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
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
import { users } from "./rbac";

/**
 * Nómina receipts (Workia 2.0, W2-03). Workia distributes the CFDI the payroll
 * provider stamped; it never computes payroll or stores amounts. The PDF and
 * the XML live in object storage (src/lib/storage); these rows hold only who
 * the receipt belongs to, the CFDI identifiers used to match it, and when it
 * was delivered and first opened.
 */

export const PAYROLL_PERIOD_STATUSES = ["draft", "published"] as const;
export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUSES)[number];

/**
 * One pay period of one company (quincenal for every company today). HR
 * imports its receipts as a draft, fixes the unmatched ones, then publishes:
 * from that moment the matched receipts are delivered to the employees.
 */
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status")
      .$type<PayrollPeriodStatus>()
      .notNull()
      .default("draft"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedBy: uuid("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("payroll_periods_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    unique("payroll_periods_company_label_unique").on(
      table.companyId,
      table.label,
    ),
    index("payroll_periods_company_end_idx").on(
      table.companyId,
      table.periodEnd,
    ),
    check(
      "payroll_periods_status_check",
      sql`${table.status} IN ('draft', 'published')`,
    ),
    check(
      "payroll_periods_label_check",
      sql`char_length(${table.label}) BETWEEN 1 AND 80`,
    ),
    check(
      "payroll_periods_dates_check",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check(
      "payroll_periods_published_check",
      sql`(${table.status} = 'published') = (${table.publishedAt} IS NOT NULL)`,
    ),
  ],
);

export type PayrollPeriod = typeof payrollPeriods.$inferSelect;

export const PAYROLL_MATCH_KINDS = [
  "curp",
  "num_empleado",
  "rfc",
  "manual",
] as const;
export type PayrollMatchKind = (typeof PAYROLL_MATCH_KINDS)[number];

/**
 * One stamped CFDI de nómina. person_id is null while the receipt is
 * unmatched; delivered_at is set when its period is published (or when HR
 * matches it by hand after that), opened_at the first time the employee
 * downloads it. The receptor fields are the identifiers the CFDI carries, kept
 * so HR can see why a receipt did not match. No amount is stored.
 */
export const payrollReceipts = pgTable(
  "payroll_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    periodId: uuid("period_id").notNull(),
    personId: uuid("person_id"),
    matchKind: text("match_kind").$type<PayrollMatchKind>(),
    cfdiUuid: uuid("cfdi_uuid").notNull(),
    receptorRfc: text("receptor_rfc").notNull(),
    receptorCurp: text("receptor_curp"),
    receptorNumEmpleado: text("receptor_num_empleado"),
    receptorName: text("receptor_name"),
    paymentDate: date("payment_date"),
    xmlKey: text("xml_key").notNull(),
    xmlBytes: integer("xml_bytes").notNull(),
    pdfKey: text("pdf_key"),
    pdfBytes: integer("pdf_bytes"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("payroll_receipts_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    unique("payroll_receipts_company_cfdi_unique").on(
      table.companyId,
      table.cfdiUuid,
    ),
    foreignKey({
      name: "payroll_receipts_company_period_fk",
      columns: [table.companyId, table.periodId],
      foreignColumns: [payrollPeriods.companyId, payrollPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payroll_receipts_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    index("payroll_receipts_company_period_idx").on(
      table.companyId,
      table.periodId,
    ),
    // The employee's list: their delivered receipts, newest first.
    index("payroll_receipts_company_person_delivered_idx")
      .on(table.companyId, table.personId, table.deliveredAt.desc())
      .where(sql`${table.personId} IS NOT NULL`),
    check(
      "payroll_receipts_match_check",
      sql`(${table.personId} IS NULL) = (${table.matchKind} IS NULL)`,
    ),
    check(
      "payroll_receipts_match_kind_check",
      sql`${table.matchKind} IS NULL OR ${table.matchKind} IN ('curp', 'num_empleado', 'rfc', 'manual')`,
    ),
    check(
      "payroll_receipts_delivered_check",
      sql`${table.deliveredAt} IS NULL OR ${table.personId} IS NOT NULL`,
    ),
    check(
      "payroll_receipts_opened_check",
      sql`${table.openedAt} IS NULL OR ${table.deliveredAt} IS NOT NULL`,
    ),
    check(
      "payroll_receipts_pdf_check",
      sql`(${table.pdfKey} IS NULL) = (${table.pdfBytes} IS NULL)`,
    ),
    check(
      "payroll_receipts_identifiers_check",
      sql`char_length(${table.receptorRfc}) <= 13 AND (${table.receptorCurp} IS NULL OR char_length(${table.receptorCurp}) = 18) AND (${table.receptorNumEmpleado} IS NULL OR char_length(${table.receptorNumEmpleado}) <= 15) AND (${table.receptorName} IS NULL OR char_length(${table.receptorName}) <= 254)`,
    ),
  ],
);

export type PayrollReceipt = typeof payrollReceipts.$inferSelect;

/**
 * The payroll provider's NumEmpleado for a person, learned from receipts:
 * when a receipt matches by CURP or RFC, or HR matches it by hand, its
 * NumEmpleado is remembered, so the next period matches by number even when
 * the CFDI's CURP or RFC differs from the expediente.
 */
export const payrollEmployeeNumbers = pgTable(
  "payroll_employee_numbers",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    numEmpleado: text("num_empleado").notNull(),
    personId: uuid("person_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "payroll_employee_numbers_pkey",
      columns: [table.companyId, table.numEmpleado],
    }),
    foreignKey({
      name: "payroll_employee_numbers_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    index("payroll_employee_numbers_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "payroll_employee_numbers_num_check",
      sql`char_length(${table.numEmpleado}) BETWEEN 1 AND 15`,
    ),
  ],
);
