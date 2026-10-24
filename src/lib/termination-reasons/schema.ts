import { z } from "zod";

import type { TerminationClassification } from "@/lib/db/schema/employment";

/** Who decided the baja (migration 0027); the turnover report splits by it. */
export const TERMINATION_CLASSIFICATIONS = [
  "voluntaria",
  "involuntaria",
  "otra",
] as const satisfies readonly TerminationClassification[];

export const terminationClassificationLabels: Record<
  TerminationClassification,
  string
> = {
  voluntaria: "Voluntaria",
  involuntaria: "Involuntaria",
  otra: "Otra",
};

/**
 * The base list of motivos de baja every company starts with (Iniciativa 2),
 * each with the classification it gets by default. Migration 0025 seeds the
 * first 13 names, 0027 their classification and the two trial-period ones.
 * Each company renames, deactivates, reclassifies or adds its own without
 * touching other companies.
 */
export const TERMINATION_REASON_SEED = [
  { name: "Renuncia voluntaria", classification: "voluntaria" },
  { name: "Mejor oferta laboral", classification: "voluntaria" },
  { name: "Motivos personales o familiares", classification: "voluntaria" },
  { name: "Cambio de residencia", classification: "voluntaria" },
  { name: "Abandono de empleo", classification: "voluntaria" },
  { name: "Faltas injustificadas", classification: "involuntaria" },
  { name: "Bajo desempeño", classification: "involuntaria" },
  { name: "Incumplimiento de políticas", classification: "involuntaria" },
  {
    name: "Reestructura o recorte de personal",
    classification: "involuntaria",
  },
  { name: "Fin de contrato o proyecto", classification: "involuntaria" },
  { name: "Jubilación", classification: "otra" },
  { name: "Fallecimiento", classification: "otra" },
  { name: "Otro", classification: "otra" },
  { name: "No aprobó el periodo de prueba", classification: "involuntaria" },
  { name: "No aceptó renovar contrato", classification: "voluntaria" },
] as const satisfies readonly {
  name: string;
  classification: TerminationClassification;
}[];

/**
 * The catalog form. A reason created by hand needs its classification; one
 * from before migration 0027 may stay «sin clasificar» (null) until HR
 * picks one, so editing its name or status does not force it.
 */
export const terminationReasonFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  classification: z.enum(TERMINATION_CLASSIFICATIONS).nullable().default(null),
  active: z.boolean().default(true),
});

/** Input of the domain functions: classification may be left out (null). */
export type TerminationReasonFormValues = z.input<
  typeof terminationReasonFormSchema
>;
