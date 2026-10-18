import { z } from "zod";

import {
  assignActivityToPosition,
  createActivity,
  createArea,
  createPosition,
  getActivityById,
  getAreaById,
  getPositionById,
  listActivities,
  listActivitiesForPosition,
  listAreas,
  listPositions,
  unassignActivityFromPosition,
} from "@/lib/catalog";
import {
  activityFormSchema,
  areaFormSchema,
  positionFormSchema,
} from "@/lib/catalog/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { catalogKey } from "@/lib/import/format";
import { countActivePeopleInPosition } from "@/lib/people";
import { createSite, listSites } from "@/lib/sites";
import { siteFormSchema, siteKindLabels } from "@/lib/sites/schema";

import { McpToolError, notFound } from "../errors";
import {
  defineWriteTool,
  writeAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import { requirePermission, uuid } from "./common";

const KIND_LABELS = {
  area: "el área",
  position: "el puesto",
  activity: "la actividad",
  site: "la ubicación",
} as const;

type CatalogKind = keyof typeof KIND_LABELS;

/** Activities reuse positions:* in the app (src/lib/catalog/auth.ts). */
const KIND_PERMISSIONS: Record<CatalogKind, PermissionSlug> = {
  area: "areas:create",
  position: "positions:create",
  activity: "positions:create",
  site: "sites:create",
};

const existingNames = async (ctx: WorkiaToolContext, kind: CatalogKind) => {
  switch (kind) {
    case "area":
      return (await listAreas(ctx.companyId)).map((row) => row.name);
    case "position":
      return (await listPositions(ctx.companyId)).map((row) => row.name);
    case "activity":
      return (await listActivities(ctx.companyId)).map((row) => row.name);
    case "site":
      return (await listSites(ctx.companyId)).map((row) => row.name);
  }
};

export const createCatalogItemTool = defineWriteTool({
  name: "create_catalog_item",
  title: "Crear en el catálogo",
  description:
    "Crea un área, un puesto, una actividad o una ubicación (sucursal o corporativo). CONFLICT si ya existe uno con el mismo nombre (sin importar mayúsculas, acentos ni espacios). site_kind es obligatorio para kind=site. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:catalog",
  // The tool's own floor; each kind also needs its create permission.
  permission: "positions:create",
  input: z.object({
    kind: z.enum(["area", "position", "activity", "site"]),
    name: z.string().trim().min(1).max(120),
    parent_area_id: uuid("Área padre (kind=area).").optional(),
    area_id: uuid("Área del puesto (kind=position).").optional(),
    site_kind: z
      .enum(["corporativo", "sucursal"])
      .optional()
      .describe("Obligatorio para kind=site."),
  }),
  output: z.object({
    item: z.object({ kind: z.string(), id: z.string(), name: z.string() }),
  }),
  annotations: writeAnnotations("Crear en el catálogo"),
  preview: async (args, ctx) => {
    requirePermission(ctx, KIND_PERMISSIONS[args.kind]);

    if (args.kind === "site" && !args.site_kind) {
      throw new McpToolError(
        "VALIDATION",
        "Para una ubicación indica site_kind: sucursal o corporativo.",
      );
    }

    const parentId =
      args.kind === "area"
        ? args.parent_area_id
        : args.kind === "position"
          ? args.area_id
          : undefined;

    if (parentId && !(await getAreaById(ctx.companyId, parentId))) {
      throw notFound("El área");
    }

    const key = catalogKey(args.name);
    const duplicate = (await existingNames(ctx, args.kind)).find(
      (name) => catalogKey(name) === key,
    );

    if (duplicate) {
      throw new McpToolError(
        "CONFLICT",
        `Ya existe ${KIND_LABELS[args.kind]} «${duplicate}».`,
      );
    }

    return {
      summary:
        args.kind === "site"
          ? `Alta de ${KIND_LABELS.site} «${args.name}» (${siteKindLabels[args.site_kind!]}).`
          : `Alta de ${KIND_LABELS[args.kind]} «${args.name}».`,
    };
  },
  handler: async (args, ctx) => {
    requirePermission(ctx, KIND_PERMISSIONS[args.kind]);

    const created = await (async () => {
      switch (args.kind) {
        case "area":
          return createArea(
            ctx.companyId,
            areaFormSchema.parse({
              name: args.name,
              parentAreaId: args.parent_area_id ?? "",
              active: true,
            }),
            ctx.userId,
          );
        case "position":
          return createPosition(
            ctx.companyId,
            positionFormSchema.parse({
              name: args.name,
              areaId: args.area_id ?? "",
              active: true,
            }),
            ctx.userId,
          );
        case "activity":
          return createActivity(
            ctx.companyId,
            activityFormSchema.parse({ name: args.name, active: true }),
            ctx.userId,
          );
        case "site":
          return createSite(
            ctx.companyId,
            siteFormSchema.parse({ name: args.name, kind: args.site_kind }),
            ctx.userId,
          );
      }
    })();

    return { item: { kind: args.kind, id: created.id, name: created.name } };
  },
});

const linkInput = z.object({
  position_id: uuid("Puesto."),
  activity_id: uuid("Actividad."),
});

const loadPair = async (
  ctx: WorkiaToolContext,
  positionId: string,
  activityId: string,
) => {
  const [position, activity] = await Promise.all([
    getPositionById(ctx.companyId, positionId),
    getActivityById(ctx.companyId, activityId),
  ]);

  if (!position || position.deletedAt) throw notFound("El puesto");
  if (!activity || activity.deletedAt) throw notFound("La actividad");

  return { position, activity };
};

const positionOutput = z.object({
  position: z.object({
    id: z.string(),
    name: z.string(),
    activities: z.array(z.string()),
  }),
  changed: z.boolean(),
});

export const linkPositionActivityTool = defineWriteTool({
  name: "link_position_activity",
  title: "Asignar actividad a puesto",
  description:
    "Agrega una actividad a un puesto. Si ya la tenía no cambia nada. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:catalog",
  permission: "positions:update",
  input: linkInput,
  output: positionOutput,
  annotations: writeAnnotations("Asignar actividad a puesto"),
  preview: async (args, ctx) => {
    const { position, activity } = await loadPair(
      ctx,
      args.position_id,
      args.activity_id,
    );

    if (!activity.active) {
      throw new McpToolError(
        "CONFLICT",
        `La actividad «${activity.name}» está inactiva.`,
      );
    }

    const current = await listActivitiesForPosition(ctx.companyId, position.id);

    return {
      summary: current.some((item) => item.id === activity.id)
        ? `El puesto «${position.name}» ya tiene la actividad «${activity.name}»: no cambia nada.`
        : `Asignar la actividad «${activity.name}» al puesto «${position.name}».`,
    };
  },
  handler: async (args, ctx) => {
    const { position } = await loadPair(
      ctx,
      args.position_id,
      args.activity_id,
    );
    const result = await assignActivityToPosition(
      ctx.companyId,
      args.position_id,
      args.activity_id,
      ctx.userId,
    );

    if (!result.ok) {
      throw new McpToolError(
        "CONFLICT",
        "La actividad no se puede asignar a ese puesto.",
      );
    }

    const activities = await listActivitiesForPosition(
      ctx.companyId,
      position.id,
    );

    return {
      position: {
        id: position.id,
        name: position.name,
        activities: activities.map((item) => item.name),
      },
      changed: result.created,
    };
  },
});

export const unlinkPositionActivityTool = defineWriteTool({
  name: "unlink_position_activity",
  title: "Quitar actividad de puesto",
  description:
    "Quita una actividad de un puesto y advierte cuántas personas activas tienen ese puesto. No borra la actividad del catálogo. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:catalog",
  permission: "positions:update",
  input: linkInput,
  output: positionOutput,
  annotations: writeAnnotations("Quitar actividad de puesto", {
    destructive: true,
  }),
  preview: async (args, ctx) => {
    const { position, activity } = await loadPair(
      ctx,
      args.position_id,
      args.activity_id,
    );
    const affected = await countActivePeopleInPosition(
      ctx.companyId,
      position.id,
    );

    return {
      summary: `Quitar la actividad «${activity.name}» del puesto «${position.name}».`,
      warnings:
        affected > 0
          ? [
              `${affected} ${affected === 1 ? "persona activa tiene" : "personas activas tienen"} este puesto.`,
            ]
          : undefined,
    };
  },
  handler: async (args, ctx) => {
    const { position } = await loadPair(
      ctx,
      args.position_id,
      args.activity_id,
    );
    const result = await unassignActivityFromPosition(
      ctx.companyId,
      args.position_id,
      args.activity_id,
      ctx.userId,
    );
    const activities = await listActivitiesForPosition(
      ctx.companyId,
      position.id,
    );

    return {
      position: {
        id: position.id,
        name: position.name,
        activities: activities.map((item) => item.name),
      },
      changed: result.removed,
    };
  },
});
