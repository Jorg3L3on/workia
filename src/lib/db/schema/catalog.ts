import { relations } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
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
    unique("areas_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "areas_company_parent_area_fk",
      columns: [table.companyId, table.parentAreaId],
      foreignColumns: [table.companyId, table.id],
    }),
    index("areas_parent_area_id_idx").on(table.parentAreaId),
    index("areas_deleted_at_idx").on(table.deletedAt),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
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
    unique("positions_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "positions_company_area_fk",
      columns: [table.companyId, table.areaId],
      foreignColumns: [areas.companyId, areas.id],
    }),
    index("positions_area_id_idx").on(table.areaId),
    index("positions_deleted_at_idx").on(table.deletedAt),
  ],
);

export const activities = pgTable(
  "activities",
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
    unique("activities_company_id_id_unique").on(table.companyId, table.id),
    index("activities_deleted_at_idx").on(table.deletedAt),
  ],
);

export const positionActivities = pgTable(
  "position_activities",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("position_activities_company_id_idx").on(table.companyId),
    foreignKey({
      name: "position_activities_company_position_fk",
      columns: [table.companyId, table.positionId],
      foreignColumns: [positions.companyId, positions.id],
    }),
    foreignKey({
      name: "position_activities_company_activity_fk",
      columns: [table.companyId, table.activityId],
      foreignColumns: [activities.companyId, activities.id],
    }),
    primaryKey({ columns: [table.positionId, table.activityId] }),
    index("position_activities_activity_id_idx").on(table.activityId),
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

export const positionsRelations = relations(positions, ({ one, many }) => ({
  area: one(areas, {
    fields: [positions.areaId],
    references: [areas.id],
  }),
  positionActivities: many(positionActivities),
}));

export const activitiesRelations = relations(activities, ({ many }) => ({
  positionActivities: many(positionActivities),
}));

export const positionActivitiesRelations = relations(
  positionActivities,
  ({ one }) => ({
    position: one(positions, {
      fields: [positionActivities.positionId],
      references: [positions.id],
    }),
    activity: one(activities, {
      fields: [positionActivities.activityId],
      references: [activities.id],
    }),
  }),
);

export type Area = typeof areas.$inferSelect;
export type NewArea = typeof areas.$inferInsert;
export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type PositionActivity = typeof positionActivities.$inferSelect;
export type NewPositionActivity = typeof positionActivities.$inferInsert;
