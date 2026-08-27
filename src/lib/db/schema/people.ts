import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const personStatusEnum = pgEnum("person_status", ["activa", "baja"]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    givenName: text("given_name").notNull(),
    familyName: text("family_name").notNull(),
    email: text("email"),
    status: personStatusEnum("status").notNull().default("activa"),
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
    index("people_family_name_idx").on(table.familyName),
  ],
);

export const peopleRelations = relations(people, () => ({}));

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PersonStatus = (typeof personStatusEnum.enumValues)[number];
