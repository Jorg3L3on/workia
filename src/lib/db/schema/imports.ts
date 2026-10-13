import { relations, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { people } from "./people";
import { users } from "./rbac";

import { companies } from "./companies";

export const IMPORT_JOB_TYPES = ["people"] as const;
export const IMPORT_JOB_STATUSES = [
  "uploading",
  "validating",
  "in_review",
  "applying",
  "applied",
  "failed",
  "undone",
] as const;
export const IMPORT_ROW_ACTIONS = [
  "pending",
  "create",
  "update",
  "unchanged",
  "error",
] as const;

export type ImportJobType = (typeof IMPORT_JOB_TYPES)[number];
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];
export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number];

export const importJobTypeEnum = pgEnum("import_job_type", IMPORT_JOB_TYPES);
export const importJobStatusEnum = pgEnum(
  "import_job_status",
  IMPORT_JOB_STATUSES,
);
export const importRowActionEnum = pgEnum(
  "import_row_action",
  IMPORT_ROW_ACTIONS,
);

export type ImportJobOptions = {
  createMissingCatalogs?: boolean;
  /** "all_or_nothing" aborts on any error; "valid_only" applies valid rows. */
  mode?: "all_or_nothing" | "valid_only";
  columnMapping?: Record<string, Record<string, string>>;
};

export type ImportJobCounts = {
  total?: number;
  create?: number;
  update?: number;
  unchanged?: number;
  error?: number;
  /** Rows applied so far (create + update + schedules + contracts). */
  applied?: number;
  /** Rows that changed since the review and were skipped at apply time. */
  skipped?: number;
  managersApplied?: boolean;
  chainApplied?: boolean;
  /** Catalog entries this import created, so undo can remove them. */
  createdCatalogs?: { areas: string[]; positions: string[]; sites: string[] };
  /** Rows reverted so far by an undo. */
  undone?: number;
};

export type ImportRowError = {
  field?: string;
  message: string;
  /** Warnings are shown in review but do not block the row. Default: error. */
  severity?: "error" | "warning";
};

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    type: importJobTypeEnum("type").notNull().default("people"),
    status: importJobStatusEnum("status").notNull().default("uploading"),
    fileName: text("file_name").notNull(),
    /** SHA-256 of the file, to detect re-imports of the same file. */
    fileHash: text("file_hash").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    options: jsonb("options").$type<ImportJobOptions>().notNull().default({}),
    counts: jsonb("counts").$type<ImportJobCounts>().notNull().default({}),
    failureMessage: text("failure_message"),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (table) => [
    unique("import_jobs_company_id_id_unique").on(table.companyId, table.id),
    index("import_jobs_status_idx").on(table.status),
    index("import_jobs_file_hash_idx").on(table.fileHash),
    index("import_jobs_actor_user_id_idx").on(table.actorUserId),
    index("import_jobs_created_at_idx").on(table.createdAt),
    index("import_jobs_company_created_idx").on(
      table.companyId,
      table.createdAt.desc().nullsFirst(),
    ),
    // At most one import may be applying at a time in each company.
    uniqueIndex("import_jobs_single_applying_idx")
      .on(table.companyId, table.type)
      .where(sql`${table.status} = 'applying'`),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    sheet: text("sheet").notNull(),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    normalized: jsonb("normalized").$type<Record<string, unknown>>(),
    action: importRowActionEnum("action").notNull().default("pending"),
    errors: jsonb("errors").$type<ImportRowError[]>(),
    /** Field-by-field changes for update rows: { field: [before, after] }. */
    diff: jsonb("diff").$type<Record<string, [unknown, unknown]>>(),
    targetPersonId: uuid("target_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    targetContractId: uuid("target_contract_id").references(
      () => contracts.id,
      { onDelete: "set null" },
    ),
    /** State of the target before the apply, so the import can be undone. */
    previousSnapshot: jsonb("previous_snapshot").$type<Record<
      string,
      unknown
    > | null>(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("import_rows_company_id_idx").on(table.companyId),
    foreignKey({
      name: "import_rows_company_job_fk",
      columns: [table.companyId, table.jobId],
      foreignColumns: [importJobs.companyId, importJobs.id],
    }),
    foreignKey({
      name: "import_rows_company_target_person_fk",
      columns: [table.companyId, table.targetPersonId],
      foreignColumns: [people.companyId, people.id],
    }),
    foreignKey({
      name: "import_rows_company_target_contract_fk",
      columns: [table.companyId, table.targetContractId],
      foreignColumns: [contracts.companyId, contracts.id],
    }),
    // Re-sending a chunk replaces the same rows instead of duplicating them.
    uniqueIndex("import_rows_job_sheet_row_idx").on(
      table.jobId,
      table.sheet,
      table.rowNumber,
    ),
    index("import_rows_job_action_idx").on(table.jobId, table.action),
    index("import_rows_target_person_id_idx").on(table.targetPersonId),
  ],
);

export const importJobsRelations = relations(importJobs, ({ one, many }) => ({
  actor: one(users, {
    fields: [importJobs.actorUserId],
    references: [users.id],
  }),
  rows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  job: one(importJobs, {
    fields: [importRows.jobId],
    references: [importJobs.id],
  }),
}));

export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
export type ImportRow = typeof importRows.$inferSelect;
export type NewImportRow = typeof importRows.$inferInsert;
