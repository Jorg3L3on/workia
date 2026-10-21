import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { people } from "./people";
import { users } from "./rbac";

/** catalog_key(name): the importer's catalogKey() in SQL (migration 0017). */
const catalogKeyOf = (column: AnyPgColumn) => sql`catalog_key(${column})`;

/** Tipo de baja (Iniciativa 2). */
export const terminationTypeEnum = pgEnum("termination_type", [
  "voluntaria",
  "despido",
  "termino_contrato",
  "otra",
]);

/** Estado del finiquito of a closed period. */
export const finiquitoStatusEnum = pgEnum("finiquito_status", [
  "pendiente",
  "pagado",
  "no_aplica",
]);

/** Motivos de baja: a company's catalog, seeded with a base list it edits. */
export const terminationReasons = pgTable(
  "termination_reasons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
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
    unique("termination_reasons_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    uniqueIndex("termination_reasons_company_name_active_unique")
      .on(table.companyId, catalogKeyOf(table.name))
      .where(sql`${table.deletedAt} is null`),
    index("termination_reasons_deleted_at_idx").on(table.deletedAt),
  ],
);

/**
 * One employment period of a person (migration 0025): from ingreso to baja.
 * people.status and people.fecha_ingreso are derived from the current period
 * and kept in sync by the domain. A period is open while it has no fecha_baja
 * and is not a baja «sin fecha»; at most one is open per person.
 */
export const employmentPeriods = pgTable(
  "employment_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    fechaIngreso: date("fecha_ingreso"),
    /** «Reconocer antigüedad previa» chosen on the rehire that opened it. */
    reconoceAntiguedad: boolean("reconoce_antiguedad").notNull().default(false),
    fechaAntiguedadReconocida: date("fecha_antiguedad_reconocida"),
    /** The seniority date this period counts from (seniorityDate()). */
    fechaAntiguedad: date("fecha_antiguedad"),
    fechaBaja: date("fecha_baja"),
    /** Closed, but its date is unknown (backfill); kept for manual review. */
    bajaSinFecha: boolean("baja_sin_fecha").notNull().default(false),
    tipoBaja: terminationTypeEnum("tipo_baja"),
    motivoBajaId: uuid("motivo_baja_id"),
    comentarioBaja: text("comentario_baja"),
    recontratable: boolean("recontratable"),
    finiquitoEstado: finiquitoStatusEnum("finiquito_estado"),
    finiquitoFecha: date("finiquito_fecha"),
    /** Payroll data: masked without compensation:read. */
    finiquitoMonto: numeric("finiquito_monto", { precision: 12, scale: 2 }),
    /** fecha_baja came from the audit log or the last contract (backfill). */
    fechaBajaInferida: boolean("fecha_baja_inferida").notNull().default(false),
    requiereRevision: boolean("requiere_revision").notNull().default(false),
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
    unique("employment_periods_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      name: "employment_periods_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "employment_periods_company_reason_fk",
      columns: [table.companyId, table.motivoBajaId],
      foreignColumns: [terminationReasons.companyId, terminationReasons.id],
    }).onDelete("restrict"),
    uniqueIndex("employment_periods_one_open_per_person")
      .on(table.companyId, table.personId)
      .where(sql`${table.fechaBaja} is null and not ${table.bajaSinFecha}`),
    index("employment_periods_company_fecha_baja_idx").on(
      table.companyId,
      table.fechaBaja,
    ),
    index("employment_periods_person_id_idx").on(table.personId),
    index("employment_periods_motivo_baja_id_idx").on(table.motivoBajaId),
    check(
      "employment_periods_dates_check",
      sql`${table.fechaBaja} IS NULL OR ${table.fechaIngreso} IS NULL OR ${table.fechaBaja} >= ${table.fechaIngreso}`,
    ),
    check(
      "employment_periods_sin_fecha_check",
      sql`NOT ${table.bajaSinFecha} OR ${table.fechaBaja} IS NULL`,
    ),
    check(
      "employment_periods_finiquito_monto_check",
      sql`${table.finiquitoMonto} IS NULL OR ${table.finiquitoMonto} >= 0`,
    ),
  ],
);

export const employmentPeriodsRelations = relations(
  employmentPeriods,
  ({ one }) => ({
    person: one(people, {
      fields: [employmentPeriods.personId],
      references: [people.id],
    }),
    motivo: one(terminationReasons, {
      fields: [employmentPeriods.motivoBajaId],
      references: [terminationReasons.id],
    }),
  }),
);

export type TerminationReason = typeof terminationReasons.$inferSelect;
export type EmploymentPeriod = typeof employmentPeriods.$inferSelect;
export type TerminationType = (typeof terminationTypeEnum.enumValues)[number];
export type FiniquitoStatus = (typeof finiquitoStatusEnum.enumValues)[number];
