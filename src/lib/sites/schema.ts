import { z } from "zod";

export const SITE_KINDS = ["corporativo", "sucursal"] as const;

export type SiteKindValue = (typeof SITE_KINDS)[number];

export const siteKindLabels: Record<SiteKindValue, string> = {
  corporativo: "Corporativo",
  sucursal: "Sucursal",
};

export const siteFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  kind: z.enum(SITE_KINDS),
  /** Optional region (WRK-I5-4). */
  regionId: z.union([z.uuid(), z.literal("")]).optional(),
});

export type SiteFormValues = z.infer<typeof siteFormSchema>;
