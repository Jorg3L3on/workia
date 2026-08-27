import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const siteKindEnum = pgEnum("site_kind", ["corporativo", "sucursal"]);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    kind: siteKindEnum("kind").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sites_deleted_at_idx").on(table.deletedAt)],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SiteKind = (typeof siteKindEnum.enumValues)[number];
