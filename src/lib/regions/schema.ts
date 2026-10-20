import { z } from "zod";

export const regionFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  active: z.boolean().default(true),
});

export type RegionFormValues = z.infer<typeof regionFormSchema>;
