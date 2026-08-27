import { z } from "zod";

export const PERSON_STATUSES = ["activa", "baja"] as const;

export type PersonStatusValue = (typeof PERSON_STATUSES)[number];

export const personStatusLabels: Record<PersonStatusValue, string> = {
  activa: "Activa",
  baja: "Baja",
};

export const personFormSchema = z.object({
  givenName: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  familyName: z
    .string()
    .trim()
    .min(1, "Los apellidos son obligatorios")
    .max(120, "Máximo 120 caracteres"),
  email: z
    .string()
    .trim()
    .email("Correo electrónico inválido")
    .max(254)
    .optional()
    .or(z.literal("")),
  status: z.enum(PERSON_STATUSES),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

export const formatPersonName = (person: {
  givenName: string;
  familyName: string;
}) => `${person.givenName} ${person.familyName}`.trim();
