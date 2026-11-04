import { z } from "zod";

/** The transfer form (W2-24). Client-safe. */
const optionalId = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.uuid({ error: "Elige un registro de la lista." }).nullable());

export const transferFormSchema = z.object({
  toCompanyId: z.uuid({ error: "Elige la empresa a la que se traslada." }),
  fechaTraslado: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de traslado es obligatoria."),
  areaId: optionalId,
  positionId: optionalId,
  siteId: optionalId,
  managerId: optionalId,
  comentario: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres.")
    .transform((value) => value || null),
});

export type TransferFormValues = z.infer<typeof transferFormSchema>;
