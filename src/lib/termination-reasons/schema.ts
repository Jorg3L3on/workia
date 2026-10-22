import { z } from "zod";

/**
 * The base list of motivos de baja every company starts with (Iniciativa 2);
 * migration 0025 seeds the same names. Each company renames, deactivates or
 * adds its own without touching other companies.
 */
export const TERMINATION_REASON_SEED = [
  "Renuncia voluntaria",
  "Mejor oferta laboral",
  "Motivos personales o familiares",
  "Cambio de residencia",
  "Abandono de empleo",
  "Faltas injustificadas",
  "Bajo desempeño",
  "Incumplimiento de políticas",
  "Reestructura o recorte de personal",
  "Fin de contrato o proyecto",
  "Jubilación",
  "Fallecimiento",
  "Otro",
] as const;

export const terminationReasonFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  active: z.boolean().default(true),
});

export type TerminationReasonFormValues = z.infer<
  typeof terminationReasonFormSchema
>;
