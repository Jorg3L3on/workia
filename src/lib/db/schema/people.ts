import { relations, sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { areas, positions } from "./catalog";
import { sites } from "./sites";

import { companies } from "./companies";

/**
 * One text blob per person (name, RFC, CURP, email) that list search runs
 * ILIKE against; `people_search_trgm_idx` indexes this exact expression, so
 * the query must use it verbatim.
 */
export const personSearchText = (table: {
  nombres: AnyPgColumn;
  apellidoPaterno: AnyPgColumn;
  apellidoMaterno: AnyPgColumn;
  rfc: AnyPgColumn;
  curp: AnyPgColumn;
  email: AnyPgColumn;
}) =>
  sql`(${table.nombres} || ' ' || ${table.apellidoPaterno} || ' ' || coalesce(${table.apellidoMaterno}, '') || ' ' || coalesce(${table.rfc}, '') || ' ' || coalesce(${table.curp}, '') || ' ' || coalesce(${table.email}, ''))`;

export const personStatusEnum = pgEnum("person_status", ["activa", "baja"]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    nombres: text("nombres").notNull(),
    apellidoPaterno: text("apellido_paterno").notNull(),
    apellidoMaterno: text("apellido_materno"),
    email: text("email"),
    telefono: text("telefono"),
    fechaNacimiento: date("fecha_nacimiento"),
    fechaIngreso: date("fecha_ingreso"),
    areaId: uuid("area_id").references(() => areas.id, {
      onDelete: "set null",
    }),
    positionId: uuid("position_id").references(() => positions.id, {
      onDelete: "set null",
    }),
    managerId: uuid("manager_id").references((): AnyPgColumn => people.id, {
      onDelete: "set null",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    rfc: text("rfc"),
    curp: text("curp"),
    nss: text("nss"),
    status: personStatusEnum("status").notNull().default("activa"),
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
    unique("people_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "people_company_area_fk",
      columns: [table.companyId, table.areaId],
      foreignColumns: [areas.companyId, areas.id],
    }),
    foreignKey({
      name: "people_company_position_fk",
      columns: [table.companyId, table.positionId],
      foreignColumns: [positions.companyId, positions.id],
    }),
    foreignKey({
      name: "people_company_manager_fk",
      columns: [table.companyId, table.managerId],
      foreignColumns: [table.companyId, table.id],
    }),
    foreignKey({
      name: "people_company_site_fk",
      columns: [table.companyId, table.siteId],
      foreignColumns: [sites.companyId, sites.id],
    }),
    index("people_status_idx").on(table.status),
    index("people_apellido_paterno_idx").on(table.apellidoPaterno),
    index("people_deleted_at_idx").on(table.deletedAt),
    index("people_area_id_idx").on(table.areaId),
    index("people_position_id_idx").on(table.positionId),
    index("people_manager_id_idx").on(table.managerId),
    index("people_site_id_idx").on(table.siteId),
    index("people_search_trgm_idx").using(
      "gin",
      sql`${personSearchText(table)} gin_trgm_ops`,
    ),
    // Identity is unique per company: the same person may work for two companies.
    uniqueIndex("people_company_curp_active_unique")
      .on(table.companyId, table.curp)
      .where(sql`${table.deletedAt} is null and ${table.curp} is not null`),
    uniqueIndex("people_company_rfc_active_unique")
      .on(table.companyId, table.rfc)
      .where(sql`${table.deletedAt} is null and ${table.rfc} is not null`),
    uniqueIndex("people_company_nss_active_unique")
      .on(table.companyId, table.nss)
      .where(sql`${table.deletedAt} is null and ${table.nss} is not null`),
    index("people_company_live_updated_idx")
      .on(table.companyId, table.updatedAt)
      .where(sql`${table.deletedAt} is null`),
    index("people_company_status_family_idx")
      .on(table.companyId, table.status, table.apellidoPaterno)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const personSchedules = pgTable(
  "person_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" })
      .unique(),
    entrada: text("entrada"),
    salidaComer: text("salida_comer"),
    regresoComer: text("regreso_comer"),
    salida: text("salida"),
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
    index("person_schedules_company_id_idx").on(table.companyId),
    foreignKey({
      name: "person_schedules_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }),
    index("person_schedules_person_id_idx").on(table.personId),
    index("person_schedules_deleted_at_idx").on(table.deletedAt),
  ],
);

export const peopleRelations = relations(people, ({ one, many }) => ({
  area: one(areas, {
    fields: [people.areaId],
    references: [areas.id],
  }),
  position: one(positions, {
    fields: [people.positionId],
    references: [positions.id],
  }),
  manager: one(people, {
    fields: [people.managerId],
    references: [people.id],
    relationName: "personManager",
  }),
  site: one(sites, {
    fields: [people.siteId],
    references: [sites.id],
  }),
  schedule: one(personSchedules, {
    fields: [people.id],
    references: [personSchedules.personId],
  }),
  directReports: many(people, { relationName: "personManager" }),
}));

export const personSchedulesRelations = relations(
  personSchedules,
  ({ one }) => ({
    person: one(people, {
      fields: [personSchedules.personId],
      references: [people.id],
    }),
  }),
);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PersonStatus = (typeof personStatusEnum.enumValues)[number];
export type PersonSchedule = typeof personSchedules.$inferSelect;
export type NewPersonSchedule = typeof personSchedules.$inferInsert;
