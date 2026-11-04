import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";
import { users } from "./rbac";

/**
 * Privacy, retention and ARCO (Workia 2.0, W2-09). Each company is the
 * «responsable» of its people's data under the LFPDPPP, so every table is
 * company-scoped like the other business tables.
 */

/**
 * One published version of a company's privacy notice. Rows are never
 * edited: a change is a new version, and acceptances point at the version
 * the person saw.
 */
export const privacyNotices = pgTable(
  "privacy_notices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    publishedBy: uuid("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("privacy_notices_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    unique("privacy_notices_company_version_unique").on(
      table.companyId,
      table.version,
    ),
    check("privacy_notices_version_check", sql`${table.version} > 0`),
    check(
      "privacy_notices_body_check",
      sql`char_length(${table.body}) BETWEEN 1 AND 50000`,
    ),
  ],
);

export const PRIVACY_ACCEPTANCE_CHANNELS = ["employee_app", "hr"] as const;
export type PrivacyAcceptanceChannel =
  (typeof PRIVACY_ACCEPTANCE_CHANNELS)[number];

/**
 * A person accepted one version of the notice: in the employee app at first
 * login (channel employee_app) or on paper, recorded by HR (channel hr).
 */
export const privacyNoticeAcceptances = pgTable(
  "privacy_notice_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    noticeId: uuid("notice_id").notNull(),
    personId: uuid("person_id").notNull(),
    channel: text("channel").$type<PrivacyAcceptanceChannel>().notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("privacy_notice_acceptances_company_notice_person_unique").on(
      table.companyId,
      table.noticeId,
      table.personId,
    ),
    foreignKey({
      name: "privacy_notice_acceptances_company_notice_fk",
      columns: [table.companyId, table.noticeId],
      foreignColumns: [privacyNotices.companyId, privacyNotices.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "privacy_notice_acceptances_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    index("privacy_notice_acceptances_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "privacy_notice_acceptances_channel_check",
      sql`${table.channel} IN ('employee_app', 'hr')`,
    ),
  ],
);

export const PERSONAL_DATA_RESOURCES = [
  "contract_pdf",
  "document_file",
  "payroll_receipt",
  "vacation_constancia",
  "arco_export",
] as const;
export type PersonalDataResource = (typeof PERSONAL_DATA_RESOURCES)[number];

export const PERSONAL_DATA_ACTORS = ["hr_user", "employee", "mcp"] as const;
export type PersonalDataActor = (typeof PERSONAL_DATA_ACTORS)[number];

/**
 * One read of a document or receipt about a person: who opened what, when.
 * Append-only; the retention job deletes rows past their period.
 */
export const personalDataAccessLog = pgTable(
  "personal_data_access_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    resource: text("resource").$type<PersonalDataResource>().notNull(),
    resourceId: uuid("resource_id"),
    actorKind: text("actor_kind").$type<PersonalDataActor>().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    accessedAt: timestamp("accessed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "personal_data_access_log_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    index("personal_data_access_log_company_person_idx").on(
      table.companyId,
      table.personId,
      table.accessedAt.desc(),
    ),
    index("personal_data_access_log_company_accessed_idx").on(
      table.companyId,
      table.accessedAt,
    ),
    check(
      "personal_data_access_log_resource_check",
      sql`${table.resource} IN ('contract_pdf', 'document_file', 'payroll_receipt', 'vacation_constancia', 'arco_export')`,
    ),
    check(
      "personal_data_access_log_actor_check",
      sql`${table.actorKind} IN ('hr_user', 'employee', 'mcp')`,
    ),
  ],
);

export const ARCO_KINDS = [
  "access",
  "rectification",
  "cancellation",
  "opposition",
] as const;
export type ArcoKind = (typeof ARCO_KINDS)[number];

export const ARCO_STATUSES = ["received", "resolved", "rejected"] as const;
export type ArcoStatus = (typeof ARCO_STATUSES)[number];

export const ARCO_CHANNELS = ["employee_app", "hr"] as const;
export type ArcoChannel = (typeof ARCO_CHANNELS)[number];

/**
 * A request by a person to access, rectify, cancel or oppose the use of
 * their data. due_on is the legal answer date, set when it is received.
 */
export const arcoRequests = pgTable(
  "arco_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    kind: text("kind").$type<ArcoKind>().notNull(),
    status: text("status").$type<ArcoStatus>().notNull().default("received"),
    channel: text("channel").$type<ArcoChannel>().notNull(),
    detail: text("detail").notNull(),
    response: text("response"),
    receivedOn: date("received_on").notNull(),
    dueOn: date("due_on").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("arco_requests_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "arco_requests_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    index("arco_requests_company_status_due_idx").on(
      table.companyId,
      table.status,
      table.dueOn,
    ),
    index("arco_requests_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    check(
      "arco_requests_kind_check",
      sql`${table.kind} IN ('access', 'rectification', 'cancellation', 'opposition')`,
    ),
    check(
      "arco_requests_status_check",
      sql`${table.status} IN ('received', 'resolved', 'rejected')`,
    ),
    check(
      "arco_requests_channel_check",
      sql`${table.channel} IN ('employee_app', 'hr')`,
    ),
    check(
      "arco_requests_detail_check",
      sql`char_length(${table.detail}) BETWEEN 1 AND 2000`,
    ),
    check(
      "arco_requests_response_check",
      sql`${table.response} IS NULL OR char_length(${table.response}) <= 4000`,
    ),
    check(
      "arco_requests_dates_check",
      sql`${table.dueOn} >= ${table.receivedOn}`,
    ),
    check(
      "arco_requests_resolution_check",
      sql`(${table.status} = 'received') = (${table.resolvedAt} IS NULL)`,
    ),
  ],
);

export type PrivacyNotice = typeof privacyNotices.$inferSelect;
export type PrivacyNoticeAcceptance =
  typeof privacyNoticeAcceptances.$inferSelect;
export type PersonalDataAccess = typeof personalDataAccessLog.$inferSelect;
export type ArcoRequest = typeof arcoRequests.$inferSelect;
