import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employmentPeriods } from "./employment";
import { people } from "./people";
import { users } from "./rbac";

/** Stages of a hiring process from HR to Payroll (WRK-I5-7). */
export const onboardingStageEnum = pgEnum("onboarding_stage", [
  "rh_captura",
  "pendiente_nominas",
  "completo",
  "rechazado",
]);

export type OnboardingChecklist = Partial<Record<string, boolean>>;

export const onboardings = pgTable(
  "onboardings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull(),
    /** The employment period this alta is for (migration 0025); one alta per period. */
    employmentPeriodId: uuid("employment_period_id"),
    stage: onboardingStageEnum("stage").notNull().default("rh_captura"),
    checklist: jsonb("checklist")
      .$type<OnboardingChecklist>()
      .notNull()
      .default({}),
    infonavitCredito: text("infonavit_credito"),
    infonavitTipoDescuento: text("infonavit_tipo_descuento"),
    infonavitFactor: numeric("infonavit_factor", { precision: 12, scale: 4 }),
    fonacotCredito: text("fonacot_credito"),
    fonacotDescuento: numeric("fonacot_descuento", { precision: 12, scale: 2 }),
    rhApprovedBy: uuid("rh_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    rhApprovedAt: timestamp("rh_approved_at", { withTimezone: true }),
    payrollApprovedBy: uuid("payroll_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    payrollApprovedAt: timestamp("payroll_approved_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One alta per employment period, so a rehired person can get a new one;
    // and never two in progress for the same person.
    uniqueIndex("onboardings_company_period_unique")
      .on(table.companyId, table.employmentPeriodId)
      .where(sql`${table.employmentPeriodId} is not null`),
    uniqueIndex("onboardings_company_person_in_progress_unique")
      .on(table.companyId, table.personId)
      .where(sql`${table.stage} in ('rh_captura', 'pendiente_nominas')`),
    index("onboardings_company_person_idx").on(table.companyId, table.personId),
    foreignKey({
      name: "onboardings_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "onboardings_company_period_fk",
      columns: [table.companyId, table.employmentPeriodId],
      foreignColumns: [employmentPeriods.companyId, employmentPeriods.id],
    }),
    index("onboardings_company_stage_idx").on(table.companyId, table.stage),
  ],
);

export type Onboarding = typeof onboardings.$inferSelect;
export type OnboardingStage = (typeof onboardingStageEnum.enumValues)[number];
