import { z } from "zod";

import { listActivitiesForPosition } from "@/lib/catalog";
import { listContractsByPerson } from "@/lib/contracts";
import {
  getPersonWithRelations,
  listPeopleKeyset,
  listPersonBeneficiaries,
  PERSON_MISSING_FIELDS,
} from "@/lib/people";
import { listAssetsByPerson } from "@/lib/resguardo";

import {
  decodeCursor,
  filtersHash,
  cursorSchema,
  limitSchema,
  pageOf,
} from "../cursor";
import { notFound } from "../errors";
import { personPii } from "../mask";
import { defineTool, readAnnotations } from "../run-tool";
import {
  appUrl,
  dateFields,
  FREE_TEXT_NOTE,
  fullName,
  mx,
  nextCursorSchema,
  refSchema,
  requirePermission,
  uuid,
} from "./common";
import { horarioBloques, horarioBloquesSchema } from "./schedule";
import { datosMexico, datosMexicoSchema } from "./mexico";

const siteRefSchema = z
  .object({ id: z.string(), name: z.string(), kind: z.string() })
  .nullable();

const personListItem = z.object({
  id: z.string(),
  nombre_completo: z.string(),
  status: z.enum(["activa", "baja"]),
  deleted: z.boolean(),
  area: refSchema,
  puesto: refSchema,
  sucursal: siteRefSchema,
  fecha_ingreso: z.string().nullable(),
  fecha_ingreso_mx: z.string().nullable(),
  url: z.string(),
});

const listPeopleInput = z.object({
  query: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe(
      "Nombre, apellidos o correo. Con el scope pii también RFC y CURP.",
    ),
  status: z.enum(["activa", "baja"]).optional(),
  visibility: z
    .enum(["expediente", "deleted", "todos"])
    .default("expediente")
    .describe(
      "expediente (por defecto, sin Borrados), deleted (sólo Borrados) o todos.",
    ),
  area_id: uuid("Filtra por área.").optional(),
  position_id: uuid("Filtra por puesto.").optional(),
  site_id: uuid("Filtra por sucursal o corporativo.").optional(),
  missing: z
    .array(z.enum(PERSON_MISSING_FIELDS))
    .max(PERSON_MISSING_FIELDS.length)
    .optional()
    .describe(
      'Sólo personas a las que les falta capturar estos datos (no revela el valor). Ej.: ["horario"].',
    ),
  cursor: cursorSchema,
  limit: limitSchema,
});

export const listPeopleTool = defineTool({
  name: "list_people",
  title: "Listar personas",
  description: `Lista expedientes de personas con filtros por estatus, área, puesto, sucursal y datos faltantes (missing), ordenados por apellido. Por defecto oculta los Borrados. «¿Quién de Sucursal Centro no tiene horario?» = site_id + missing:["horario"]. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: listPeopleInput,
  output: z.object({
    items: z.array(personListItem),
    next_cursor: nextCursorSchema,
    count: z.number().int(),
  }),
  annotations: readAnnotations("Listar personas"),
  handler: async (args, ctx) => {
    const { cursor, limit, ...filters } = args;
    const searchIdentifiers = ctx.piiUnmasked;
    const hash = filtersHash("list_people", { ...filters, searchIdentifiers });
    const rows = await listPeopleKeyset(ctx.companyId, {
      query: filters.query,
      searchIdentifiers,
      status: filters.status,
      visibility: filters.visibility,
      areaId: filters.area_id,
      positionId: filters.position_id,
      siteId: filters.site_id,
      missing: filters.missing,
      after: decodeCursor(cursor, hash),
      limit,
    });
    const page = pageOf(rows, limit, hash, (row) => row.apellidoPaterno);

    return {
      items: page.items.map((row) => ({
        id: row.id,
        nombre_completo: fullName(row),
        status: row.status,
        deleted: row.deletedAt !== null,
        area: row.area?.id ? { id: row.area.id, name: row.area.name } : null,
        puesto: row.position?.id
          ? { id: row.position.id, name: row.position.name }
          : null,
        sucursal: row.site?.id
          ? { id: row.site.id, name: row.site.name, kind: row.site.kind }
          : null,
        fecha_ingreso: row.fechaIngreso,
        fecha_ingreso_mx: mx(row.fechaIngreso),
        url: appUrl(ctx, `/app/personas/${row.id}`),
      })),
      next_cursor: page.next_cursor,
      count: page.items.length,
    };
  },
});

const INCLUDES = ["horario", "contratos", "activos", "actividades"] as const;

export const getPersonTool = defineTool({
  name: "get_person",
  title: "Ver expediente",
  description: `Expediente de una persona: datos, área, puesto, sucursal, jefe, datos México (domicilio, estado civil, INE y beneficiarios; sólo con el scope pii, si no dice qué está capturado) y, según include, horario, contratos, activos en resguardo y actividades del puesto. RFC, CURP, NSS, teléfono, correo y fecha de nacimiento salen enmascarados sin el scope pii (pii_masked). ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({
    person_id: uuid("Id de la persona."),
    include: z
      .array(z.enum(INCLUDES))
      .default(["horario"])
      .describe("Secciones extra: horario, contratos, activos, actividades."),
  }),
  output: z.object({
    person: z.object({
      id: z.string(),
      nombres: z.string(),
      apellido_paterno: z.string(),
      apellido_materno: z.string().nullable(),
      nombre_completo: z.string(),
      email: z.string().nullable(),
      telefono: z.string().nullable(),
      fecha_nacimiento: z.string().nullable(),
      rfc: z.string().nullable(),
      curp: z.string().nullable(),
      nss: z.string().nullable(),
      pii_masked: z.boolean(),
      fecha_ingreso: z.string().nullable(),
      fecha_ingreso_mx: z.string().nullable(),
      status: z.enum(["activa", "baja"]),
      deleted_at: z.string().nullable(),
      area: refSchema,
      puesto: refSchema,
      sucursal: siteRefSchema,
      jefe: z
        .object({ id: z.string(), nombre_completo: z.string() })
        .nullable(),
      url: z.string(),
    }),
    datos_mexico: datosMexicoSchema,
    horario: z
      .object({
        entrada: z.string().nullable(),
        salida_comer: z.string().nullable(),
        regreso_comer: z.string().nullable(),
        salida: z.string().nullable(),
      })
      .nullable()
      .optional(),
    horario_bloques: horarioBloquesSchema.optional(),
    contratos: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          status: z.string(),
          start_date: z.string(),
          start_date_mx: z.string().nullable(),
          end_date: z.string().nullable(),
          end_date_mx: z.string().nullable(),
        }),
      )
      .optional(),
    activos: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          identifier: z.string(),
          category: z.string(),
          condition_note: z.string().nullable(),
        }),
      )
      .optional(),
    actividades: z.array(z.string()).optional(),
  }),
  annotations: readAnnotations("Ver expediente"),
  handler: async ({ person_id, include }, ctx) => {
    const wants = new Set(include);

    if (wants.has("contratos")) requirePermission(ctx, "contracts:read");
    if (wants.has("activos")) requirePermission(ctx, "assets:read");
    if (wants.has("actividades")) requirePermission(ctx, "positions:read");

    // Borrados are readable by id, as in the app's expediente.
    const person = await getPersonWithRelations(ctx.companyId, person_id, true);

    if (!person) {
      throw notFound("La persona");
    }

    const [contracts, assets, activities, beneficiaries] = await Promise.all([
      wants.has("contratos")
        ? listContractsByPerson(ctx.companyId, person.id)
        : null,
      wants.has("activos")
        ? listAssetsByPerson(ctx.companyId, person.id)
        : null,
      wants.has("actividades") && person.positionId
        ? listActivitiesForPosition(ctx.companyId, person.positionId)
        : wants.has("actividades")
          ? []
          : null,
      listPersonBeneficiaries(ctx.companyId, person.id),
    ]);
    const ingreso = dateFields(person.fechaIngreso);

    return {
      person: {
        id: person.id,
        nombres: person.nombres,
        apellido_paterno: person.apellidoPaterno,
        apellido_materno: person.apellidoMaterno,
        nombre_completo: fullName(person),
        ...personPii(person, ctx.piiUnmasked),
        fecha_ingreso: ingreso.iso,
        fecha_ingreso_mx: ingreso.mx,
        status: person.status,
        deleted_at: person.deletedAt?.toISOString() ?? null,
        area: person.area,
        puesto: person.position,
        sucursal: person.site,
        jefe: person.manager
          ? { id: person.manager.id, nombre_completo: fullName(person.manager) }
          : null,
        url: appUrl(ctx, `/app/personas/${person.id}`),
      },
      datos_mexico: datosMexico(person, beneficiaries, ctx.piiUnmasked),
      ...(wants.has("horario")
        ? {
            horario: person.schedule
              ? {
                  entrada: person.schedule.entrada,
                  salida_comer: person.schedule.salidaComer,
                  regreso_comer: person.schedule.regresoComer,
                  salida: person.schedule.salida,
                }
              : null,
            horario_bloques: horarioBloques(person.schedule),
          }
        : {}),
      ...(contracts
        ? {
            contratos: contracts.map((contract) => ({
              id: contract.id,
              type: contract.type,
              status: contract.status,
              start_date: contract.startDate,
              start_date_mx: mx(contract.startDate),
              end_date: contract.endDate,
              end_date_mx: mx(contract.endDate),
            })),
          }
        : {}),
      ...(assets
        ? {
            activos: assets.map((asset) => ({
              id: asset.id,
              name: asset.name,
              identifier: asset.identifier,
              category: asset.category,
              condition_note: asset.conditionNote,
            })),
          }
        : {}),
      ...(activities
        ? { actividades: activities.map((activity) => activity.name) }
        : {}),
    };
  },
});
