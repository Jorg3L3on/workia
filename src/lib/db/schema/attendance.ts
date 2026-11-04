import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";
import { users } from "./rbac";
import { sites } from "./sites";

/**
 * Attendance ingestion (Workia 2.0 W2-12, docs/asistencia.md). The punches
 * themselves live in person_events, one attendance row per person per day.
 * These tables hold only what ingestion needs around them: the checadores,
 * who is who on them, the app check-in points, and what HR must review.
 */

/** How a checador's CSV export reads. Checador models are not decided yet, so it is data. */
export type AttendanceCsvFormat = {
  /** "auto" detects comma, semicolon or tab from the first line. */
  delimiter: "auto" | "," | ";" | "\t";
  /** Lines to skip before the first punch (0 when the file has no header). */
  headerRows: number;
  /** A header name, or a 1-based column number. */
  badgeColumn: string;
  /** One column with date and time, or a date column plus a time column. */
  dateTimeColumn?: string | null;
  dateColumn?: string | null;
  timeColumn?: string | null;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY/MM/DD";
  /** Optional entrada/salida column and the values that mean each. */
  kindColumn?: string | null;
  inValues?: string[];
  outValues?: string[];
};

/**
 * One checador (or any device or system that sends punches). HR uploads its
 * CSV export, or the device pushes through /api/asistencia/checadas with its
 * own token. Never hard-deleted: deactivating it revokes the token.
 */
export const attendanceDevices = pgTable(
  "attendance_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id"),
    name: text("name").notNull(),
    csvFormat: jsonb("csv_format").$type<AttendanceCsvFormat>().notNull(),
    /** SHA-256 of the push token; null when the device has no API access. */
    tokenHash: text("token_hash"),
    /** Last characters of the token, to tell tokens apart on screen. */
    tokenHint: text("token_hint"),
    active: boolean("active").default(true).notNull(),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("attendance_devices_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    uniqueIndex("attendance_devices_company_name_unique").on(
      table.companyId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex("attendance_devices_token_hash_unique")
      .on(table.tokenHash)
      .where(sql`${table.tokenHash} is not null`),
    foreignKey({
      name: "attendance_devices_company_site_fk",
      columns: [table.companyId, table.siteId],
      foreignColumns: [sites.companyId, sites.id],
    }).onDelete("restrict"),
    check(
      "attendance_devices_name_check",
      sql`char_length(${table.name}) BETWEEN 1 AND 80`,
    ),
    check(
      "attendance_devices_csv_format_check",
      sql`jsonb_typeof(${table.csvFormat}) = 'object' AND pg_column_size(${table.csvFormat}) <= 2048`,
    ),
  ],
);

/**
 * A person's number on the checadores (the enrollment id the device prints in
 * its export). Unique per company: the same number on every checador.
 */
export const attendanceBadges = pgTable(
  "attendance_badges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    badge: text("badge").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("attendance_badges_company_badge_unique").on(
      table.companyId,
      table.badge,
    ),
    index("attendance_badges_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    foreignKey({
      name: "attendance_badges_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    check(
      "attendance_badges_badge_check",
      sql`char_length(${table.badge}) BETWEEN 1 AND 40`,
    ),
  ],
);

export const ATTENDANCE_QR_MODES = ["rotating", "printed"] as const;
export type AttendanceQrMode = (typeof ATTENDANCE_QR_MODES)[number];

/**
 * App check-in at a site: where it is, how close a phone must be, and the
 * secret its QR codes are signed with. Rotating codes change every minute on
 * a screen at the site; a printed code lasts until HR rotates the secret.
 */
export const attendanceCheckinSites = pgTable(
  "attendance_checkin_sites",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    radiusMeters: integer("radius_meters").default(150).notNull(),
    qrMode: text("qr_mode")
      .$type<AttendanceQrMode>()
      .default("rotating")
      .notNull(),
    qrSecret: text("qr_secret").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "attendance_checkin_sites_pkey",
      columns: [table.companyId, table.siteId],
    }),
    foreignKey({
      name: "attendance_checkin_sites_company_site_fk",
      columns: [table.companyId, table.siteId],
      foreignColumns: [sites.companyId, sites.id],
    }).onDelete("cascade"),
    check(
      "attendance_checkin_sites_position_check",
      sql`${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180`,
    ),
    check(
      "attendance_checkin_sites_radius_check",
      sql`${table.radiusMeters} BETWEEN 25 AND 2000`,
    ),
    check(
      "attendance_checkin_sites_qr_mode_check",
      sql`${table.qrMode} IN ('rotating', 'printed')`,
    ),
  ],
);

export const ATTENDANCE_BATCH_SOURCES = ["csv", "device"] as const;
export type AttendanceBatchSource = (typeof ATTENDANCE_BATCH_SOURCES)[number];

/**
 * What one ingestion did: one row per CSV upload, and one per device per day
 * for pushes (the counts add up), so a device pushing every minute stays one
 * row a day on the 1 GB Neon Free plan.
 */
export const attendanceBatches = pgTable(
  "attendance_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id").notNull(),
    source: text("source").$type<AttendanceBatchSource>().notNull(),
    /** Device pushes: the local day the counts belong to. */
    pushDay: date("push_day"),
    fileName: text("file_name"),
    rows: integer("rows").default(0).notNull(),
    punchesAdded: integer("punches_added").default(0).notNull(),
    duplicates: integer("duplicates").default(0).notNull(),
    unmatched: integer("unmatched").default(0).notNull(),
    invalid: integer("invalid").default(0).notNull(),
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
    unique("attendance_batches_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "attendance_batches_company_device_fk",
      columns: [table.companyId, table.deviceId],
      foreignColumns: [attendanceDevices.companyId, attendanceDevices.id],
    }).onDelete("restrict"),
    index("attendance_batches_company_created_idx").on(
      table.companyId,
      table.createdAt.desc(),
    ),
    uniqueIndex("attendance_batches_device_push_day_unique")
      .on(table.deviceId, table.pushDay)
      .where(sql`${table.source} = 'device'`),
    check(
      "attendance_batches_source_check",
      sql`${table.source} IN ('csv', 'device')`,
    ),
    check(
      "attendance_batches_push_day_check",
      sql`(${table.source} = 'device') = (${table.pushDay} IS NOT NULL)`,
    ),
    check(
      "attendance_batches_counts_check",
      sql`${table.rows} >= 0 AND ${table.punchesAdded} >= 0 AND ${table.duplicates} >= 0 AND ${table.unmatched} >= 0 AND ${table.invalid} >= 0`,
    ),
  ],
);

export const ATTENDANCE_UNMATCHED_REASONS = [
  "unknown_badge",
  "invalid_row",
] as const;
export type AttendanceUnmatchedReason =
  (typeof ATTENDANCE_UNMATCHED_REASONS)[number];

/**
 * A punch ingestion could not place, with the raw row as it came: a number no
 * person has on the checadores, or a row that does not read. HR assigns the
 * number to a person (its punches are then ingested) or dismisses the row.
 */
export const attendanceUnmatched = pgTable(
  "attendance_unmatched",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    reason: text("reason").$type<AttendanceUnmatchedReason>().notNull(),
    /** Line of the file (CSV) or index in the request (device push), from 1. */
    line: integer("line").notNull(),
    badge: text("badge"),
    punchedAt: timestamp("punched_at", { withTimezone: true }),
    kind: text("kind"),
    raw: jsonb("raw").$type<string[]>().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "attendance_unmatched_company_batch_fk",
      columns: [table.companyId, table.batchId],
      foreignColumns: [attendanceBatches.companyId, attendanceBatches.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "attendance_unmatched_company_device_fk",
      columns: [table.companyId, table.deviceId],
      foreignColumns: [attendanceDevices.companyId, attendanceDevices.id],
    }).onDelete("restrict"),
    // HR's open list, newest first, and the punches waiting on one number.
    index("attendance_unmatched_open_idx")
      .on(table.companyId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.resolvedAt} is null`),
    index("attendance_unmatched_open_badge_idx")
      .on(table.companyId, table.badge)
      .where(sql`${table.resolvedAt} is null`),
    // The same punch reported twice stays one row.
    uniqueIndex("attendance_unmatched_punch_unique")
      .on(table.companyId, table.badge, table.punchedAt)
      .where(
        sql`${table.badge} is not null and ${table.punchedAt} is not null`,
      ),
    // ...and the same unreadable line too.
    uniqueIndex("attendance_unmatched_invalid_unique")
      .on(table.companyId, table.deviceId, sql`md5(${table.raw}::text)`)
      .where(sql`${table.reason} = 'invalid_row'`),
    check(
      "attendance_unmatched_reason_check",
      sql`${table.reason} IN ('unknown_badge', 'invalid_row')`,
    ),
    check(
      "attendance_unmatched_kind_check",
      sql`${table.kind} IS NULL OR ${table.kind} IN ('in', 'out')`,
    ),
    check(
      "attendance_unmatched_raw_check",
      sql`jsonb_typeof(${table.raw}) = 'array' AND pg_column_size(${table.raw}) <= 2048`,
    ),
    check(
      "attendance_unmatched_badge_check",
      sql`${table.badge} IS NULL OR char_length(${table.badge}) BETWEEN 1 AND 40`,
    ),
  ],
);

export type AttendanceDevice = typeof attendanceDevices.$inferSelect;
export type AttendanceBadge = typeof attendanceBadges.$inferSelect;
export type AttendanceCheckinSite = typeof attendanceCheckinSites.$inferSelect;
export type AttendanceBatch = typeof attendanceBatches.$inferSelect;
export type AttendanceUnmatchedRow = typeof attendanceUnmatched.$inferSelect;
