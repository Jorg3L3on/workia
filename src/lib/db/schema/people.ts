import { relations } from "drizzle-orm";
import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { areas, positions } from "./catalog";
import { sites } from "./sites";

export const personStatusEnum = pgEnum("person_status", ["activa", "baja"]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    index("people_status_idx").on(table.status),
    index("people_apellido_paterno_idx").on(table.apellidoPaterno),
    index("people_deleted_at_idx").on(table.deletedAt),
    index("people_area_id_idx").on(table.areaId),
    index("people_position_id_idx").on(table.positionId),
    index("people_manager_id_idx").on(table.managerId),
    index("people_site_id_idx").on(table.siteId),
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
  directReports: many(people, { relationName: "personManager" }),
}));

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PersonStatus = (typeof personStatusEnum.enumValues)[number];
