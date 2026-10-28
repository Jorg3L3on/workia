import { z } from "zod";

import { getPersonById } from "@/lib/people";
import { getEmploymentSummary } from "@/lib/people/employment";
import {
  VACATION_PRIMA_TEXT,
  vacationEntitlementForPerson,
  vacationToolFields,
} from "@/lib/people/vacation-card";

import { notFound } from "../errors";
import { defineTool, readAnnotations } from "../run-tool";
import { appUrl, uuid } from "./common";

const dateOrNull = z.string().nullable();

/**
 * Read-only. The output is `vacationToolFields` plus the expediente url:
 * the same view as the Vacaciones card. No free-text field and no note.
 */
export const getVacationEntitlementTool = defineTool({
  name: "get_vacation_entitlement",
  title: "Derecho a vacaciones",
  description:
    "Derecho a vacaciones de una persona, el mismo que muestra la tarjeta Vacaciones del expediente: año de servicio cumplido, aniversario actual y siguiente, días de derecho y fecha límite para otorgarlas. Con menos de un año de servicio no hay días ni fecha límite. Si la fecha de antigüedad es posterior a la de cálculo, la antigüedad aún no inicia. No incluye días tomados ni saldo.",
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({
    person_id: uuid("Id de la persona."),
  }),
  output: z.object({
    state: z.enum([
      "no_hire_date",
      "not_started",
      "before_table",
      "proportional",
      "entitled",
      "closed",
      "error",
    ]),
    message: z
      .string()
      .nullable()
      .describe("Aviso fijo del estado. No es un texto capturado."),
    service_years_completed: z.number().int().nullable(),
    current_anniversary: dateOrNull,
    current_anniversary_mx: dateOrNull,
    next_anniversary: dateOrNull,
    next_anniversary_mx: dateOrNull,
    entitlement_days: z.number().int().nullable(),
    grant_by: dateOrNull.describe(
      "Fecha límite para otorgarlas. Null si aún no hay derecho.",
    ),
    grant_by_mx: dateOrNull,
    prima_vacacional: z
      .literal(VACATION_PRIMA_TEXT)
      .nullable()
      .describe("Texto fijo del artículo 80. Null cuando no hay derecho."),
    closed: z
      .boolean()
      .describe("true cuando el periodo laboral está cerrado."),
    as_of: dateOrNull,
    as_of_mx: dateOrNull,
    url: z.string(),
  }),
  annotations: readAnnotations("Derecho a vacaciones"),
  handler: async ({ person_id }, ctx) => {
    const person = await getPersonById(ctx.companyId, person_id);

    if (!person) {
      throw notFound("La persona");
    }

    const summary = await getEmploymentSummary(ctx.companyId, person_id);
    const view = vacationEntitlementForPerson({
      seniorityDate: summary ? summary.fechaAntiguedad : person.fechaIngreso,
      status: person.status,
      fechaBaja: summary?.fechaBaja ?? null,
      today: ctx.today,
    });

    return {
      ...vacationToolFields(view),
      url: appUrl(ctx, `/app/personas/${person.id}`),
    };
  },
});
