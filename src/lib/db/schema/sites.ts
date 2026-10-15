import { sql } from "drizzle-orm";
import {
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

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
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
  (table) => [
    unique("sites_company_id_id_unique").on(table.companyId, table.id),
    uniqueIndex("sites_company_name_active_unique")
      .on(table.companyId, sql`catalog_key(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    index("sites_deleted_at_idx").on(table.deletedAt),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SiteKind = (typeof siteKindEnum.enumValues)[number];
