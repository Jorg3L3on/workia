import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { users } from "./rbac";

/**
 * Saved views of the Personas list (Iniciativa 3): a filter and the visible
 * columns, personal or shared with the members of the same company. The
 * filter is the PeopleFilter object and is validated again when read.
 */
export const peopleViews = pgTable(
  "people_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: jsonb("filter").$type<unknown>().notNull().default({}),
    columns: jsonb("columns").$type<string[]>().notNull().default([]),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("people_views_company_owner_idx").on(
      table.companyId,
      table.ownerUserId,
    ),
    index("people_views_company_shared_idx")
      .on(table.companyId)
      .where(sql`${table.shared}`),
  ],
);

export type PeopleView = typeof peopleViews.$inferSelect;
