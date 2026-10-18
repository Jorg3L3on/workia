import { z } from "zod";

import {
  listActivities,
  listActivitiesByPositionIds,
  listAreas,
  listPositions,
} from "@/lib/catalog";
import { listSites } from "@/lib/sites";
import { listRegions } from "@/lib/regions";

import { defineTool, readAnnotations } from "../run-tool";
import { FREE_TEXT_NOTE, uuid } from "./common";

// The catalog is small: no cursor, a plain limit (spec §7).
const catalogLimit = z
  .number()
  .int()
  .min(1)
  .max(500)
  .default(200)
  .describe("Cuántos resultados (por defecto 200).");

const truncated = z
  .boolean()
  .describe("true si había más resultados que el límite.");

export const listAreasTool = defineTool({
  name: "list_areas",
  title: "Listar áreas",
  description: `Áreas de la empresa con su área padre. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "areas:read",
  input: z.object({
    include_inactive: z.boolean().default(false),
    limit: catalogLimit,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        parent_area_id: z.string().nullable(),
        active: z.boolean(),
      }),
    ),
    truncated,
  }),
  annotations: readAnnotations("Listar áreas"),
  handler: async ({ include_inactive, limit }, ctx) => {
    const rows = (await listAreas(ctx.companyId)).filter(
      (area) => include_inactive || area.active,
    );

    return {
      items: rows.slice(0, limit).map((area) => ({
        id: area.id,
        name: area.name,
        parent_area_id: area.parentAreaId,
        active: area.active,
      })),
      truncated: rows.length > limit,
    };
  },
});

export const listPositionsTool = defineTool({
  name: "list_positions",
  title: "Listar puestos",
  description: `Puestos de la empresa con su área y, opcionalmente, sus actividades. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "positions:read",
  input: z.object({
    area_id: uuid("Sólo los puestos de esta área.").optional(),
    include_activities: z.boolean().default(true),
    include_inactive: z.boolean().default(false),
    limit: catalogLimit,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        area_id: z.string().nullable(),
        active: z.boolean(),
        activities: z.array(z.string()).optional(),
      }),
    ),
    truncated,
  }),
  annotations: readAnnotations("Listar puestos"),
  handler: async (args, ctx) => {
    const rows = (
      await listPositions(ctx.companyId, { areaId: args.area_id })
    ).filter((position) => args.include_inactive || position.active);
    const page = rows.slice(0, args.limit);
    const activities = args.include_activities
      ? await listActivitiesByPositionIds(
          ctx.companyId,
          page.map((position) => position.id),
        )
      : null;

    return {
      items: page.map((position) => ({
        id: position.id,
        name: position.name,
        area_id: position.areaId,
        active: position.active,
        ...(activities
          ? {
              activities: (activities.get(position.id) ?? []).map(
                (activity) => activity.name,
              ),
            }
          : {}),
      })),
      truncated: rows.length > args.limit,
    };
  },
});

export const listActivitiesTool = defineTool({
  name: "list_activities",
  title: "Listar actividades",
  description: `Actividades del catálogo (se asignan a puestos). ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  // Activities reuse positions:* in the app (src/lib/catalog/auth.ts).
  permission: "positions:read",
  input: z.object({
    query: z.string().trim().max(120).optional().describe("Parte del nombre."),
    include_inactive: z.boolean().default(false),
    limit: catalogLimit,
  }),
  output: z.object({
    items: z.array(
      z.object({ id: z.string(), name: z.string(), active: z.boolean() }),
    ),
    truncated,
  }),
  annotations: readAnnotations("Listar actividades"),
  handler: async (args, ctx) => {
    const needle = args.query?.toLocaleLowerCase("es-MX");
    const rows = (await listActivities(ctx.companyId)).filter(
      (activity) =>
        (args.include_inactive || activity.active) &&
        (!needle || activity.name.toLocaleLowerCase("es-MX").includes(needle)),
    );

    return {
      items: rows.slice(0, args.limit).map((activity) => ({
        id: activity.id,
        name: activity.name,
        active: activity.active,
      })),
      truncated: rows.length > args.limit,
    };
  },
});

export const listSitesTool = defineTool({
  name: "list_sites",
  title: "Listar sucursales",
  description: `Ubicaciones de la empresa: sucursales y corporativo. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "sites:read",
  input: z.object({
    kind: z.enum(["corporativo", "sucursal"]).optional(),
    region_id: uuid(
      "Sólo sucursales de esta región (list_regions).",
    ).optional(),
    limit: catalogLimit,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        region_id: z.string().nullable(),
      }),
    ),
    truncated,
  }),
  annotations: readAnnotations("Listar sucursales"),
  handler: async (args, ctx) => {
    const rows = (await listSites(ctx.companyId)).filter(
      (site) =>
        (!args.kind || site.kind === args.kind) &&
        (!args.region_id || site.regionId === args.region_id),
    );

    return {
      items: rows.slice(0, args.limit).map((site) => ({
        id: site.id,
        name: site.name,
        kind: site.kind,
        region_id: site.regionId,
      })),
      truncated: rows.length > args.limit,
    };
  },
});

export const listRegionsTool = defineTool({
  name: "list_regions",
  title: "Listar regiones",
  description: `Regiones de la empresa con sus sucursales. Usa su id como region_id en list_people, list_sites, list_renewal_tray y list_expiring_contracts. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "sites:read",
  input: z.object({
    include_inactive: z.boolean().default(false),
    limit: catalogLimit,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        active: z.boolean(),
        sucursales: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),
    truncated,
  }),
  annotations: readAnnotations("Listar regiones"),
  handler: async (args, ctx) => {
    const [regionRows, siteRows] = await Promise.all([
      listRegions(ctx.companyId, { activeOnly: !args.include_inactive }),
      listSites(ctx.companyId),
    ]);

    return {
      items: regionRows.slice(0, args.limit).map((region) => ({
        id: region.id,
        name: region.name,
        active: region.active,
        sucursales: siteRows
          .filter((site) => site.regionId === region.id)
          .map((site) => ({ id: site.id, name: site.name })),
      })),
      truncated: regionRows.length > args.limit,
    };
  },
});
