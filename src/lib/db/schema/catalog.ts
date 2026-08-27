import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    parentAreaId: uuid("parent_area_id").references(
      (): AnyPgColumn => areas.id,
      {
        onDelete: "set null",
      },
    ),
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
    index("areas_parent_area_id_idx").on(table.parentAreaId),
    index("areas_deleted_at_idx").on(table.deletedAt),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    areaId: uuid("area_id").references(() => areas.id, {
      onDelete: "set null",
    }),
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
    index("positions_area_id_idx").on(table.areaId),
    index("positions_deleted_at_idx").on(table.deletedAt),
  ],
);

export const areasRelations = relations(areas, ({ one, many }) => ({
  parent: one(areas, {
    fields: [areas.parentAreaId],
    references: [areas.id],
    relationName: "areaTree",
  }),
  children: many(areas, { relationName: "areaTree" }),
  positions: many(positions),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  area: one(areas, {
    fields: [positions.areaId],
    references: [areas.id],
  }),
}));

export type Area = typeof areas.$inferSelect;
export type NewArea = typeof areas.$inferInsert;
export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
