import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { users } from "./rbac";

/** What a saved view filters: the Personas list or the turnover report. */
export const PEOPLE_VIEW_KINDS = ["people", "turnover"] as const;

export type PeopleViewKind = (typeof PEOPLE_VIEW_KINDS)[number];

/**
 * Saved views of the Personas list (Iniciativa 3): a filter and the visible
 * columns, personal or shared with the members of the same company. The
 * filter is the PeopleFilter object and is validated again when read.
 * kind (migration 0027): «people» for the Personas list, «turnover» for the
 * turnover report, whose filter is a TurnoverFilter.
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
    kind: text("kind").$type<PeopleViewKind>().notNull().default("people"),
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
    check(
      "people_views_kind_check",
      sql`${table.kind} IN ('people', 'turnover')`,
    ),
  ],
);

export type PeopleView = typeof peopleViews.$inferSelect;
