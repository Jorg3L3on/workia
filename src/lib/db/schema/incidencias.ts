import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./rbac";
import { companies } from "./companies";
import { people } from "./people";

/**
 * The rules the incidencias engine applies (Workia 2.0 W2-14), per company
 * and the quincena they start in. The rules of a period are the row with the
 * latest `effective_period` up to it; with no row, the defaults of
 * src/lib/incidencias/rules.ts. HR's changes always start in the next
 * quincena, so a period that is already running keeps its rules. Who changed
 * them is also in audit_events.
 */
export const incidenciaRules = pgTable(
  "incidencia_rules",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** First quincena these rules apply to: 'YYYY-MM-Q1' or 'YYYY-MM-Q2'. */
    effectivePeriod: text("effective_period").notNull(),
    /** Minutes after the entry time that are not yet a retardo. */
    retardoToleranceMinutes: smallint("retardo_tolerance_minutes").notNull(),
    /** Minutes before the exit time that are not yet a salida anticipada. */
    salidaToleranceMinutes: smallint("salida_tolerance_minutes").notNull(),
    /** A late arrival of more than this many minutes is a falta; null: never. */
    faltaAfterMinutes: smallint("falta_after_minutes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "incidencia_rules_pkey",
      columns: [table.companyId, table.effectivePeriod],
    }),
    check(
      "incidencia_rules_period_check",
      sql`${table.effectivePeriod} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-Q[12]$'`,
    ),
    check(
      "incidencia_rules_minutes_check",
      sql`${table.retardoToleranceMinutes} BETWEEN 0 AND 120 AND ${table.salidaToleranceMinutes} BETWEEN 0 AND 120 AND (${table.faltaAfterMinutes} IS NULL OR ${table.faltaAfterMinutes} BETWEEN ${table.retardoToleranceMinutes} + 1 AND 720)`,
    ),
  ],
);

export const INCIDENCIA_JUSTIFICATION_KINDS = [
  "permiso_con_goce",
  "permiso_sin_goce",
  "incapacidad_imss",
  "override",
] as const;

export type IncidenciaJustificationKind =
  (typeof INCIDENCIA_JUSTIFICATION_KINDS)[number];

/**
 * Why a person's incidencias are justified or cancelled (W2-14): a permiso
 * or an IMSS incapacidad over a range of days, or an HR override of one
 * incidencia of one day (justify it, or void it) with a reason. Vacations
 * justify too, but they are read from vacation_records. The engine reads the
 * rows not cancelled; a cancel keeps the row and who did it, so the history
 * of every decision stays.
 */
export const incidenciaJustifications = pgTable(
  "incidencia_justifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    kind: text("kind").$type<IncidenciaJustificationKind>().notNull(),
    fromDay: date("from_day").notNull(),
    toDay: date("to_day").notNull(),
    /** Override only: the incidencia it decides on. */
    incidenciaKind: text("incidencia_kind").$type<
      "falta" | "retardo" | "salida_anticipada"
    >(),
    /** justify: the incidencia stays, justified. void (override only): cancelled. */
    effect: text("effect").$type<"justify" | "void">().notNull(),
    reason: text("reason").notNull(),
    /** Folio of the IMSS incapacidad, number of the permiso, ... */
    reference: text("reference"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    foreignKey({
      name: "incidencia_justifications_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    // The engine reads one batch of people over one quincena.
    index("incidencia_justifications_company_person_from_idx").on(
      table.companyId,
      table.personId,
      table.fromDay,
    ),
    check(
      "incidencia_justifications_kind_check",
      sql`${table.kind} IN ('permiso_con_goce', 'permiso_sin_goce', 'incapacidad_imss', 'override')`,
    ),
    check(
      "incidencia_justifications_dates_check",
      sql`${table.toDay} >= ${table.fromDay} AND ${table.toDay} - ${table.fromDay} <= 366`,
    ),
    check(
      "incidencia_justifications_override_check",
      sql`(${table.kind} = 'override' AND ${table.incidenciaKind} IN ('falta', 'retardo', 'salida_anticipada') AND ${table.fromDay} = ${table.toDay}) OR (${table.kind} <> 'override' AND ${table.incidenciaKind} IS NULL AND ${table.effect} = 'justify')`,
    ),
    check(
      "incidencia_justifications_effect_check",
      sql`${table.effect} IN ('justify', 'void')`,
    ),
    check(
      "incidencia_justifications_text_check",
      sql`char_length(${table.reason}) BETWEEN 1 AND 280 AND (${table.reference} IS NULL OR char_length(${table.reference}) <= 80) AND (${table.cancelReason} IS NULL OR char_length(${table.cancelReason}) <= 280)`,
    ),
    check(
      "incidencia_justifications_cancel_check",
      sql`(${table.cancelledAt} IS NULL) = (${table.cancelReason} IS NULL)`,
    ),
  ],
);

export type IncidenciaRulesRow = typeof incidenciaRules.$inferSelect;
export type IncidenciaJustification =
  typeof incidenciaJustifications.$inferSelect;
