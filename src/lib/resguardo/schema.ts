import { z } from "zod";

import type { AssetMovementType, AssetStatus } from "@/lib/db/schema/assets";

export const assetCategoryLabels: Record<string, string> = {
  moto: "Motocicleta",
  laptop: "Laptop",
  telefono: "Teléfono",
  consumible: "Consumible",
  otro: "Otro",
};

export const assetStatusLabels: Record<AssetStatus, string> = {
  disponible: "En almacén",
  asignado: "Asignado",
  baja: "Baja",
};

export const assetMovementTypeLabels: Record<AssetMovementType, string> = {
  entrega: "Entrega",
  devolucion: "Devolución",
};

export const assetFormSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  identifier: z.string().trim().min(1, "El identificador es obligatorio."),
  category: z.string().trim().min(1, "La categoría es obligatoria."),
  tracksHistory: z.boolean(),
});

export type AssetFormValues = z.infer<typeof assetFormSchema>;

export const assignAssetFormSchema = z.object({
  assetId: z.string().uuid("Activo no válido."),
  personId: z.string().uuid("Persona no válida."),
  movementDate: z.string().trim().min(1, "La fecha de entrega es obligatoria."),
  conditionNote: z
    .string()
    .trim()
    .min(1, "La condición al entregar es obligatoria."),
  notes: z.string().trim().optional(),
});

export type AssignAssetFormValues = z.infer<typeof assignAssetFormSchema>;

export const returnAssetFormSchema = z.object({
  assetId: z.string().uuid("Activo no válido."),
  movementDate: z
    .string()
    .trim()
    .min(1, "La fecha de devolución es obligatoria."),
  conditionNote: z
    .string()
    .trim()
    .min(1, "La condición al devolver es obligatoria."),
  notes: z.string().trim().optional(),
});

export type ReturnAssetFormValues = z.infer<typeof returnAssetFormSchema>;

export const formatAssetDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
};

export const isTrackableAsset = (tracksHistory: boolean) => tracksHistory;
