import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { employeeAccounts } from "./employee-accounts";
import { onboardings } from "./onboardings";
import { people } from "./people";
import { users } from "./rbac";

/**
 * Self-service onboarding (Workia 2.0 W2-10). HR opens it from an alta in
 * «Captura RH»; the new hire fills their personal and expediente México
 * fields from /mi; HR reviews and applies them to the expediente. The
 * employee never writes the people row: their values wait here until HR
 * applies them.
 *
 * - invitado: HR opened it; the person may save a draft.
 * - enviado: the person sent it; locked until HR decides.
 * - devuelto: HR sent it back with a reason; the person edits and resends.
 * - aplicado: HR applied it; closed.
 */
export const ONBOARDING_INTAKE_STATUSES = [
  "invitado",
  "enviado",
  "devuelto",
  "aplicado",
] as const;

export type OnboardingIntakeStatus =
  (typeof ONBOARDING_INTAKE_STATUSES)[number];

/** Why HR sends it back: a closed list, so no free text holds health data. */
export const ONBOARDING_INTAKE_RETURN_REASONS = [
  "incompleto",
  "datos_incorrectos",
  "identificador_duplicado",
] as const;

export type OnboardingIntakeReturnReason =
  (typeof ONBOARDING_INTAKE_RETURN_REASONS)[number];

/** The employee's values, by person field (src/lib/onboarding/intake-schema.ts). */
export type OnboardingIntakeData = Record<string, unknown>;

export const onboardingIntakes = pgTable(
  "onboarding_intakes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    onboardingId: uuid("onboarding_id").notNull(),
    personId: uuid("person_id").notNull(),
    status: text("status")
      .$type<OnboardingIntakeStatus>()
      .notNull()
      .default("invitado"),
    data: jsonb("data").$type<OnboardingIntakeData>().notNull().default({}),
    returnReason: text("return_reason").$type<OnboardingIntakeReturnReason>(),
    /** Set when HR applies: how many of the form's fields came from the person. */
    fieldsTotal: integer("fields_total"),
    fieldsByEmployee: integer("fields_by_employee"),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedByAccountId: uuid("submitted_by_account_id"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One self-service form per alta.
    uniqueIndex("onboarding_intakes_onboarding_unique").on(
      table.companyId,
      table.onboardingId,
    ),
    index("onboarding_intakes_company_person_idx").on(
      table.companyId,
      table.personId,
    ),
    foreignKey({
      name: "onboarding_intakes_company_onboarding_fk",
      columns: [table.companyId, table.onboardingId],
      foreignColumns: [onboardings.companyId, onboardings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "onboarding_intakes_company_person_fk",
      columns: [table.companyId, table.personId],
      foreignColumns: [people.companyId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "onboarding_intakes_company_submitted_by_fk",
      columns: [table.companyId, table.submittedByAccountId],
      foreignColumns: [employeeAccounts.companyId, employeeAccounts.id],
    }).onDelete("set null"),
    check(
      "onboarding_intakes_status_check",
      sql`${table.status} IN ('invitado', 'enviado', 'devuelto', 'aplicado')`,
    ),
    check(
      "onboarding_intakes_return_reason_check",
      sql`(${table.status} = 'devuelto') = (${table.returnReason} IS NOT NULL) AND (${table.returnReason} IS NULL OR ${table.returnReason} IN ('incompleto', 'datos_incorrectos', 'identificador_duplicado'))`,
    ),
    check(
      "onboarding_intakes_submitted_check",
      sql`${table.status} NOT IN ('enviado', 'aplicado') OR ${table.submittedAt} IS NOT NULL`,
    ),
    check(
      "onboarding_intakes_applied_check",
      sql`(${table.status} = 'aplicado') = (${table.fieldsTotal} IS NOT NULL) AND (${table.fieldsTotal} IS NULL) = (${table.fieldsByEmployee} IS NULL) AND (${table.fieldsByEmployee} IS NULL OR ${table.fieldsByEmployee} BETWEEN 0 AND ${table.fieldsTotal})`,
    ),
  ],
);

export type OnboardingIntake = typeof onboardingIntakes.$inferSelect;
