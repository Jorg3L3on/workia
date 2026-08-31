import { relations, sql } from "drizzle-orm";
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
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { people } from "./people";

export const contractTypeEnum = pgEnum("contract_type", [
  "determinado",
  "indeterminado",
]);

export const contractNoticeWindowEnum = pgEnum("contract_notice_window", [
  "1",
  "2",
  "3",
  "6",
  "no_avisar",
]);

export const contractStatusEnum = pgEnum("contract_status", [
  "vigente",
  "renovado",
  "no_renovado",
  "vencido",
]);

export const contractTemplates = pgTable(
  "contract_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    body: text("body").notNull(),
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
    index("contract_templates_active_idx").on(table.active),
    index("contract_templates_deleted_at_idx").on(table.deletedAt),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    type: contractTypeEnum("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    noticeWindow: contractNoticeWindowEnum("notice_window")
      .notNull()
      .default("no_avisar"),
    templateId: uuid("template_id").references(() => contractTemplates.id, {
      onDelete: "set null",
    }),
    templateName: text("template_name"),
    generatedText: text("generated_text").notNull(),
    scheduleEntrada: text("schedule_entrada"),
    scheduleSalidaComer: text("schedule_salida_comer"),
    scheduleRegresoComer: text("schedule_regreso_comer"),
    scheduleSalida: text("schedule_salida"),
    status: contractStatusEnum("status").notNull().default("vigente"),
    previousContractId: uuid("previous_contract_id").references(
      (): AnyPgColumn => contracts.id,
      { onDelete: "set null" },
    ),
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
    index("contracts_person_id_idx").on(table.personId),
    index("contracts_status_idx").on(table.status),
    index("contracts_end_date_idx").on(table.endDate),
    index("contracts_deleted_at_idx").on(table.deletedAt),
    index("contracts_vigente_person_idx")
      .on(table.personId)
      .where(sql`${table.status} = 'vigente' AND ${table.deletedAt} IS NULL`),
  ],
);

export const contractTemplatesRelations = relations(
  contractTemplates,
  ({ many }) => ({
    contracts: many(contracts),
  }),
);

export const contractsRelations = relations(contracts, ({ one }) => ({
  person: one(people, {
    fields: [contracts.personId],
    references: [people.id],
  }),
  template: one(contractTemplates, {
    fields: [contracts.templateId],
    references: [contractTemplates.id],
  }),
  previousContract: one(contracts, {
    fields: [contracts.previousContractId],
    references: [contracts.id],
    relationName: "contractHistory",
  }),
}));

export type ContractType = (typeof contractTypeEnum.enumValues)[number];
export type ContractNoticeWindow =
  (typeof contractNoticeWindowEnum.enumValues)[number];
export type ContractStatus = (typeof contractStatusEnum.enumValues)[number];
export type Contract = typeof contracts.$inferSelect;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
