import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { people } from "./people";

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
