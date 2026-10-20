import { z } from "zod";

import {
  getAssetWithHolder,
  listAssetMovements,
  listAssetsKeyset,
} from "@/lib/resguardo";
import {
  assetMovementTypeLabels,
  assetStatusLabels,
} from "@/lib/resguardo/schema";

import {
  cursorSchema,
  decodeCursor,
  filtersHash,
  limitSchema,
  pageOf,
} from "../cursor";
import { notFound } from "../errors";
import { defineTool, readAnnotations } from "../run-tool";
import {
  appUrl,
  FREE_TEXT_NOTE,
  fullName,
  mx,
  nextCursorSchema,
  personRefSchema,
  uuid,
} from "./common";

const ASSET_STATUSES = ["disponible", "asignado", "baja"] as const;

export const listAssetsTool = defineTool({
  name: "list_assets",
  title: "Listar activos",
  description: `Activos en resguardo con su resguardante actual. «¿Quién tiene la moto M-03?» = query "M-03". Filtros por estado, categoría (moto, laptop, telefono, consumible, otro; texto libre) y resguardante. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "assets:read",
  input: z.object({
    query: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe(
        "Nombre, identificador (serie, placa, inventario) o categoría.",
      ),
    status: z.enum(ASSET_STATUSES).optional(),
    category: z.string().trim().max(60).optional(),
    holder_id: uuid("Sólo los activos que tiene esta persona.").optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        identifier: z.string(),
        category: z.string(),
        status: z.string(),
        status_label: z.string(),
        holder: personRefSchema.nullable(),
        since: z.string().nullable(),
        since_mx: z.string().nullable(),
        condition_note: z.string().nullable(),
        url: z.string(),
      }),
    ),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Listar activos"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    const hash = filtersHash("list_assets", filters);
    const rows = await listAssetsKeyset(ctx.companyId, {
      query: filters.query,
      status: filters.status,
      category: filters.category,
      holderId: filters.holder_id,
      after: decodeCursor(cursor, hash),
      limit,
    });
    const page = pageOf(rows, limit, hash, (row) => row.name);

    return {
      items: page.items.map((row) => ({
        id: row.id,
        name: row.name,
        identifier: row.identifier,
        category: row.category,
        status: row.status,
        status_label: assetStatusLabels[row.status],
        holder: row.holderId
          ? {
              id: row.holderId,
              nombre_completo: fullName({
                nombres: row.holderNombres ?? "",
                apellidoPaterno: row.holderApellidoPaterno ?? "",
                apellidoMaterno: row.holderApellidoMaterno,
              }),
            }
          : null,
        since: row.since,
        since_mx: mx(row.since),
        condition_note: row.conditionNote,
        url: appUrl(ctx, `/app/resguardo/${row.id}`),
      })),
      next_cursor: page.next_cursor,
    };
  },
});

export const getAssetTool = defineTool({
  name: "get_asset",
  title: "Ver activo",
  description: `Un activo con su resguardante y el historial de entregas y devoluciones (fecha, condición, notas). ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "assets:read",
  input: z.object({ asset_id: uuid("Id del activo.") }),
  output: z.object({
    asset: z.object({
      id: z.string(),
      name: z.string(),
      identifier: z.string(),
      category: z.string(),
      status: z.string(),
      status_label: z.string(),
      tracks_history: z.boolean(),
      holder: personRefSchema.nullable(),
      condition_note: z.string().nullable(),
      url: z.string(),
    }),
    movements: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        type_label: z.string(),
        person: personRefSchema,
        movement_date: z.string(),
        movement_date_mx: z.string().nullable(),
        condition_note: z.string().nullable(),
        notes: z.string().nullable(),
      }),
    ),
  }),
  annotations: readAnnotations("Ver activo"),
  handler: async ({ asset_id }, ctx) => {
    const asset = await getAssetWithHolder(ctx.companyId, asset_id);

    if (!asset) {
      throw notFound("El activo");
    }

    const movements = await listAssetMovements(ctx.companyId, asset.id);

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        identifier: asset.identifier,
        category: asset.category,
        status: asset.status,
        status_label: assetStatusLabels[asset.status],
        tracks_history: asset.tracksHistory,
        holder: asset.holder
          ? { id: asset.holder.id, nombre_completo: fullName(asset.holder) }
          : null,
        condition_note: asset.conditionNote,
        url: appUrl(ctx, `/app/resguardo/${asset.id}`),
      },
      movements: movements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        type_label: assetMovementTypeLabels[movement.type],
        person: {
          id: movement.person.id,
          nombre_completo: fullName(movement.person),
        },
        movement_date: movement.movementDate,
        movement_date_mx: mx(movement.movementDate),
        condition_note: movement.conditionNote,
        notes: movement.notes,
      })),
    };
  },
});
