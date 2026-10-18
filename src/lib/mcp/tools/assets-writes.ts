import { z } from "zod";

import { getPersonById } from "@/lib/people";
import {
  assignAsset,
  createAsset,
  getAssetWithHolder,
  listAssetsKeyset,
  returnAsset,
} from "@/lib/resguardo";
import {
  assetFormSchema,
  assignAssetFormSchema,
  returnAssetFormSchema,
} from "@/lib/resguardo/schema";

import { McpToolError, notFound } from "../errors";
import { defineWriteTool, writeAnnotations } from "../run-tool";
import { appUrl, fullName, isoDate, mx, personRefSchema, uuid } from "./common";

const assetRef = z.object({
  id: z.string(),
  name: z.string(),
  identifier: z.string(),
  status: z.string(),
  holder: personRefSchema.nullable().optional(),
  url: z.string(),
});

const conflict = (message: string) => new McpToolError("CONFLICT", message);

export const registerAssetTool = defineWriteTool({
  name: "register_asset",
  title: "Registrar activo",
  description:
    "Da de alta un activo en resguardo (queda «En almacén»). category es texto libre; usa moto, laptop, telefono, consumible u otro. CONFLICT si ya hay un activo con ese identificador. Primero responde una vista previa; repite la llamada con confirmation_token para hacerlo.",
  scope: "write:assets",
  permission: "assets:create",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Serie, placa o número de inventario."),
    category: z.string().trim().min(1).max(60),
    tracks_history: z.boolean().default(true),
  }),
  output: z.object({ asset: assetRef }),
  annotations: writeAnnotations("Registrar activo"),
  preview: async (args, ctx) => {
    const [existing] = await listAssetsKeyset(ctx.companyId, {
      query: args.identifier,
      limit: 20,
    });

    if (
      existing &&
      existing.identifier.toLowerCase() === args.identifier.toLowerCase()
    ) {
      throw conflict(
        `Ya existe un activo con el identificador ${args.identifier}.`,
      );
    }

    return {
      summary: `Alta del activo «${args.name}» (${args.identifier}), categoría ${args.category}, en almacén.`,
    };
  },
  handler: async (args, ctx) => {
    const input = assetFormSchema.parse({
      name: args.name,
      identifier: args.identifier,
      category: args.category,
      tracksHistory: args.tracks_history,
    });
    const created = await createAsset(ctx.companyId, input, ctx.userId);

    return {
      asset: {
        id: created.id,
        name: created.name,
        identifier: created.identifier,
        status: created.status,
        holder: null,
        url: appUrl(ctx, `/app/resguardo/${created.id}`),
      },
    };
  },
});

const loadAsset = async (companyId: string, assetId: string) => {
  const asset = await getAssetWithHolder(companyId, assetId);

  if (!asset) {
    throw notFound("El activo");
  }

  if (!asset.tracksHistory) {
    throw conflict(
      "Este activo no lleva historial de entregas y devoluciones.",
    );
  }

  return asset;
};

export const assignAssetTool = defineWriteTool({
  name: "assign_asset",
  title: "Entregar activo",
  description:
    "Entrega un activo en resguardo a una persona, con fecha y la condición en que se entrega (obligatoria). CONFLICT si ya está asignado o dado de baja. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:assets",
  permission: "assets:update",
  input: z.object({
    asset_id: uuid("Activo."),
    person_id: uuid("Persona que lo recibe."),
    movement_date: isoDate("Fecha de entrega (aaaa-mm-dd)."),
    condition_note: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Condición al entregar."),
    notes: z.string().trim().max(500).optional(),
  }),
  output: z.object({ asset: assetRef, movement_id: z.string() }),
  annotations: writeAnnotations("Entregar activo"),
  preview: async (args, ctx) => {
    const asset = await loadAsset(ctx.companyId, args.asset_id);
    const person = await getPersonById(ctx.companyId, args.person_id);

    if (!person) throw notFound("La persona");
    if (asset.status === "asignado") {
      throw conflict(
        `El activo ya está asignado${asset.holder ? ` a ${fullName(asset.holder)}` : ""}. Registra la devolución primero.`,
      );
    }
    if (asset.status === "baja")
      throw conflict("No se puede entregar un activo dado de baja.");

    return {
      summary: `Entrega de «${asset.name}» (${asset.identifier}) a ${fullName(person)} el ${mx(args.movement_date)}. Condición: ${args.condition_note}.`,
      warnings:
        person.status === "baja"
          ? ["La persona está dada de baja."]
          : undefined,
    };
  },
  handler: async (args, ctx) => {
    const input = assignAssetFormSchema.parse({
      assetId: args.asset_id,
      personId: args.person_id,
      movementDate: args.movement_date,
      conditionNote: args.condition_note,
      notes: args.notes,
    });
    const { asset, movement } = await assignAsset(
      ctx.companyId,
      input,
      ctx.userId,
    );
    const person = await getPersonById(ctx.companyId, args.person_id);

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        identifier: asset.identifier,
        status: asset.status,
        holder: person
          ? { id: person.id, nombre_completo: fullName(person) }
          : null,
        url: appUrl(ctx, `/app/resguardo/${asset.id}`),
      },
      movement_id: movement.id,
    };
  },
});

export const returnAssetTool = defineWriteTool({
  name: "return_asset",
  title: "Devolver activo",
  description:
    "Registra la devolución de un activo asignado, con fecha y la condición en que regresa (obligatoria). Queda «En almacén». CONFLICT si no está asignado. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:assets",
  permission: "assets:update",
  input: z.object({
    asset_id: uuid("Activo."),
    movement_date: isoDate("Fecha de devolución (aaaa-mm-dd)."),
    condition_note: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Condición al devolver."),
    notes: z.string().trim().max(500).optional(),
  }),
  output: z.object({ asset: assetRef, movement_id: z.string() }),
  annotations: writeAnnotations("Devolver activo"),
  preview: async (args, ctx) => {
    const asset = await loadAsset(ctx.companyId, args.asset_id);

    if (asset.status !== "asignado" || !asset.holder) {
      throw conflict("El activo no está asignado.");
    }

    return {
      summary: `Devolución de «${asset.name}» (${asset.identifier}) por ${fullName(asset.holder)} el ${mx(args.movement_date)}. Condición: ${args.condition_note}.`,
    };
  },
  handler: async (args, ctx) => {
    const input = returnAssetFormSchema.parse({
      assetId: args.asset_id,
      movementDate: args.movement_date,
      conditionNote: args.condition_note,
      notes: args.notes,
    });
    const { asset, movement } = await returnAsset(
      ctx.companyId,
      input,
      ctx.userId,
    );

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        identifier: asset.identifier,
        status: asset.status,
        holder: null,
        url: appUrl(ctx, `/app/resguardo/${asset.id}`),
      },
      movement_id: movement.id,
    };
  },
});
