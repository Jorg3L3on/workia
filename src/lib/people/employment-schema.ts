import { z } from "zod";

import type {
  FiniquitoStatus,
  TerminationType,
} from "@/lib/db/schema/employment";

/** Baja y periodos laborales (Iniciativa 2): labels and form schemas, client-safe. */
export const TERMINATION_TYPES = [
  "voluntaria",
  "despido",
  "termino_contrato",
  "otra",
] as const satisfies readonly TerminationType[];

export const terminationTypeLabels: Record<TerminationType, string> = {
  voluntaria: "Voluntaria",
  despido: "Despido",
  termino_contrato: "Término de contrato",
  otra: "Otra",
};

export const FINIQUITO_STATUSES = [
  "pendiente",
  "pagado",
  "no_aplica",
] as const satisfies readonly FiniquitoStatus[];

export const finiquitoStatusLabels: Record<FiniquitoStatus, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  no_aplica: "No aplica",
};

/** What a viewer without compensation:read sees instead of the finiquito amount. */
export const MASKED_AMOUNT = "•••";

const isoDate = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, message);

const optionalIsoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha válida.")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

/**
 * Finiquito amount in pesos. `undefined` leaves the stored one as it is: the
 * caller only sends it with compensation:read.
 */
const amount = z
  .number({ error: "El monto debe ser un número." })
  .min(0, "El monto no puede ser negativo.")
  .max(99_999_999.99, "El monto es demasiado grande.")
  .nullable()
  .optional();

export const finiquitoSchema = z.object({
  estado: z.enum(FINIQUITO_STATUSES).nullable().optional(),
  fecha: optionalIsoDate,
  monto: amount,
});

export type FiniquitoValues = z.infer<typeof finiquitoSchema>;

export const terminationSchema = z.object({
  fechaBaja: isoDate("La fecha de baja es obligatoria."),
  tipoBaja: z.enum(TERMINATION_TYPES, {
    error: "Elige el tipo de baja.",
  }),
  motivoBajaId: z.uuid({ error: "Elige el motivo de la baja." }),
  comentario: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres.")
    .nullable()
    .optional(),
  recontratable: z.boolean({
    error: "Indica si la persona es recontratable.",
  }),
  finiquito: finiquitoSchema.optional(),
});

export type TerminationValues = z.infer<typeof terminationSchema>;

export const rehireSchema = z
  .object({
    fechaIngreso: isoDate("La fecha de ingreso es obligatoria."),
    reconoceAntiguedad: z.boolean().default(false),
    fechaAntiguedadReconocida: optionalIsoDate,
  })
  .refine(
    (value) =>
      !value.fechaAntiguedadReconocida ||
      value.fechaAntiguedadReconocida <= value.fechaIngreso,
    {
      path: ["fechaAntiguedadReconocida"],
      message: "La antigüedad reconocida no puede ser posterior al ingreso.",
    },
  );

export type RehireValues = z.infer<typeof rehireSchema>;
