import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { ScheduleBlock } from "@/lib/people/schedule-blocks";

import { people, weekDayEnum } from "./people";

import { companies } from "./companies";

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

/** Compensation frozen in the contract (WRK-I5-2). */
export const paymentMethodEnum = pgEnum("payment_method", [
  "transferencia",
  "efectivo",
  "cheque",
]);

export const payFrequencyEnum = pgEnum("pay_frequency", [
  "semanal",
  "quincenal",
  "mensual",
]);

export const contractTemplates = pgTable(
  "contract_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
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
    unique("contract_templates_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    index("contract_templates_active_idx").on(table.active),
    index("contract_templates_deleted_at_idx").on(table.deletedAt),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
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
    scheduleBlocks: jsonb("schedule_blocks").$type<ScheduleBlock[]>(),
    scheduleRestDay: weekDayEnum("schedule_rest_day"),
    status: contractStatusEnum("status").notNull().default("vigente"),
    // Compensation (WRK-I5-2), frozen when the contract is issued or renewed.
    salarioDiario: numeric("salario_diario", { precision: 12, scale: 2 }),
    salarioMensual: numeric("salario_mensual", { precision: 12, scale: 2 }),
    formaPago: paymentMethodEnum("forma_pago"),
    periodicidadPago: payFrequencyEnum("periodicidad_pago"),
    diaPago: text("dia_pago"),
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
    unique("contracts_company_id_id_unique").on(table.companyId, table.id),
    foreignKey({
      name: "contracts_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }),
    foreignKey({
      name: "contracts_company_template_fk",
      columns: [table.companyId, table.templateId],
      foreignColumns: [contractTemplates.companyId, contractTemplates.id],
    }),
    foreignKey({
      name: "contracts_company_previous_contract_fk",
      columns: [table.companyId, table.previousContractId],
      foreignColumns: [table.companyId, table.id],
    }),
    index("contracts_person_id_idx").on(table.personId),
    index("contracts_status_idx").on(table.status),
    index("contracts_end_date_idx").on(table.endDate),
    index("contracts_deleted_at_idx").on(table.deletedAt),
    index("contracts_company_vigente_person_idx")
      .on(table.companyId, table.personId)
      .where(sql`${table.status} = 'vigente' AND ${table.deletedAt} IS NULL`),
    index("contracts_company_renewal_end_date_idx")
      .on(table.companyId, table.endDate)
      .where(
        sql`${table.status} = 'vigente' AND ${table.type} = 'determinado' AND ${table.deletedAt} IS NULL`,
      ),
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
