import { sql } from "drizzle-orm";
import {
  boolean,
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

import { companies } from "./companies";

export const siteKindEnum = pgEnum("site_kind", ["corporativo", "sucursal"]);

/** Regions over sites (WRK-I5-4): a company catalog, logically deleted. */
export const regions = pgTable(
  "regions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
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
    unique("regions_company_id_id_unique").on(table.companyId, table.id),
    uniqueIndex("regions_company_name_active_unique")
      .on(table.companyId, sql`catalog_key(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    index("regions_deleted_at_idx").on(table.deletedAt),
  ],
);

export type Region = typeof regions.$inferSelect;

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: siteKindEnum("kind").notNull(),
    regionId: uuid("region_id"),
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
    unique("sites_company_id_id_unique").on(table.companyId, table.id),
    uniqueIndex("sites_company_name_active_unique")
      .on(table.companyId, sql`catalog_key(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    index("sites_deleted_at_idx").on(table.deletedAt),
    foreignKey({
      name: "sites_company_region_fk",
      columns: [table.companyId, table.regionId],
      foreignColumns: [regions.companyId, regions.id],
    }).onDelete("restrict"),
    index("sites_region_id_idx").on(table.companyId, table.regionId),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SiteKind = (typeof siteKindEnum.enumValues)[number];
