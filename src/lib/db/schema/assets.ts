import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
} from "drizzle-orm/pg-core";

import { people } from "./people";

import { companies } from "./companies";

export const assetStatusEnum = pgEnum("asset_status", [
  "disponible",
  "asignado",
  "baja",
]);

export const assetMovementTypeEnum = pgEnum("asset_movement_type", [
  "entrega",
  "devolucion",
]);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    identifier: text("identifier").notNull(),
    category: text("category").notNull(),
    tracksHistory: boolean("tracks_history").notNull().default(true),
    holderId: uuid("holder_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    conditionNote: text("condition_note"),
    status: assetStatusEnum("status").notNull().default("disponible"),
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
    unique("assets_company_id_id_unique").on(table.companyId, table.id),
    uniqueIndex("assets_company_identifier_active_unique")
      .on(table.companyId, table.identifier)
      .where(sql`${table.deletedAt} is null`),
    index("assets_company_status_name_idx")
      .on(table.companyId, table.status, table.name)
      .where(sql`${table.deletedAt} is null`),
    index("assets_company_holder_idx").on(table.companyId, table.holderId),
    foreignKey({
      name: "assets_company_holder_fk",
      columns: [table.companyId, table.holderId],
      foreignColumns: [people.companyId, people.id],
    }),
    index("assets_identifier_idx").on(table.identifier),
    index("assets_holder_id_idx").on(table.holderId),
    index("assets_status_idx").on(table.status),
    index("assets_deleted_at_idx").on(table.deletedAt),
  ],
);

export const assetMovements = pgTable(
  "asset_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    type: assetMovementTypeEnum("type").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    movementDate: date("movement_date").notNull(),
    conditionNote: text("condition_note").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("asset_movements_company_id_idx").on(table.companyId),
    foreignKey({
      name: "asset_movements_company_asset_fk",
      columns: [table.companyId, table.assetId],
      foreignColumns: [assets.companyId, assets.id],
    }),
    foreignKey({
      name: "asset_movements_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }),
    index("asset_movements_asset_id_idx").on(table.assetId),
    index("asset_movements_person_id_idx").on(table.personId),
    index("asset_movements_movement_date_idx").on(table.movementDate),
  ],
);

export const assetsRelations = relations(assets, ({ one, many }) => ({
  holder: one(people, {
    fields: [assets.holderId],
    references: [people.id],
  }),
  movements: many(assetMovements),
}));

export const assetMovementsRelations = relations(assetMovements, ({ one }) => ({
  asset: one(assets, {
    fields: [assetMovements.assetId],
    references: [assets.id],
  }),
  person: one(people, {
    fields: [assetMovements.personId],
    references: [people.id],
  }),
}));

export type AssetStatus = (typeof assetStatusEnum.enumValues)[number];
export type AssetMovementType =
  (typeof assetMovementTypeEnum.enumValues)[number];
export type Asset = typeof assets.$inferSelect;
export type AssetMovement = typeof assetMovements.$inferSelect;
