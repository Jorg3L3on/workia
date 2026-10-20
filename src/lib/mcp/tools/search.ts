import { z } from "zod";

import {
  getActivityById,
  getAreaById,
  getPositionById,
  listActivitiesForPosition,
  listAreas,
  listPositions,
} from "@/lib/catalog";
import {
  getContractById,
  getContractTemplateById,
  listContractsKeyset,
} from "@/lib/contracts";
import { contractStatusLabels } from "@/lib/contracts/schema";
import {
  getPersonWithRelations,
  listPeopleKeyset,
  listPersonBeneficiaries,
} from "@/lib/people";
import {
  formatMexicanAddress,
  maritalStatusLabels,
  personStatusLabels,
} from "@/lib/people/schema";
import { getAssetWithHolder, listAssetsKeyset } from "@/lib/resguardo";
import { assetStatusLabels } from "@/lib/resguardo/schema";
import { getSiteById, listSites } from "@/lib/sites";

import { McpToolError, notFound } from "../errors";
import { personPii } from "../mask";
import {
  defineTool,
  readAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import { appUrl, FREE_TEXT_NOTE, fullName, mx } from "./common";
import { compensacionLine } from "./compensation";
import { maskContractText } from "./contract-text";

/**
 * search/fetch with OpenAI's signature (ChatGPT connectors): search(query) →
 * results[{id,title,text,url}], fetch(id) → {id,title,text,url,metadata}.
 * Ids are "type:uuid". Each entity is filtered by its own RBAC permission.
 */
const ENTITY_TYPES = [
  "person",
  "contract",
  "asset",
  "position",
  "area",
  "site",
  "activity",
  "template",
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

const PER_TYPE = 5;

const resultSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
});

const includes = (value: string, needle: string) =>
  value.toLocaleLowerCase("es-MX").includes(needle);

const searchPeople = async (ctx: WorkiaToolContext, query: string) => {
  if (!ctx.permissions.has("people:read")) return [];

  // Never by RFC or CURP here (no PII oracle), and no PII in the text.
  const people = (
    await listPeopleKeyset(ctx.companyId, {
      query,
      searchIdentifiers: false,
      limit: PER_TYPE,
    })
  ).slice(0, PER_TYPE);
  const contracts = ctx.permissions.has("contracts:read")
    ? await Promise.all(
        people.map((person) =>
          listContractsKeyset(ctx.companyId, {
            personId: person.id,
            statuses: ["vigente"],
            limit: 1,
          }).then((rows) => rows[0] ?? null),
        ),
      )
    : people.map(() => null);

  return people.flatMap((person, index) => {
    const contract = contracts[index];
    const name = fullName(person);
    const results = [
      {
        id: `person:${person.id}`,
        title: [name, person.position?.name].filter(Boolean).join(" — "),
        text: [
          personStatusLabels[person.status],
          person.area?.name,
          person.site?.name,
          contract
            ? contract.endDate
              ? `contrato ${contract.type} vence ${mx(contract.endDate)}`
              : `contrato ${contract.type}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        url: appUrl(ctx, `/app/personas/${person.id}`),
      },
    ];

    if (contract) {
      results.push({
        id: `contract:${contract.id}`,
        title: `Contrato ${contract.type} — ${name}`,
        text: `${contractStatusLabels[contract.status]} · inicio ${mx(contract.startDate)}${contract.endDate ? ` · fin ${mx(contract.endDate)}` : ""}`,
        url: appUrl(ctx, `/app/personas/${person.id}`),
      });
    }

    return results;
  });
};

const searchAssets = async (ctx: WorkiaToolContext, query: string) => {
  if (!ctx.permissions.has("assets:read")) return [];

  const assets = (
    await listAssetsKeyset(ctx.companyId, { query, limit: PER_TYPE })
  ).slice(0, PER_TYPE);

  return assets.map((asset) => ({
    id: `asset:${asset.id}`,
    title: `${asset.name} ${asset.identifier}`,
    text: asset.holderId
      ? `${assetStatusLabels[asset.status]} a ${fullName({
          nombres: asset.holderNombres ?? "",
          apellidoPaterno: asset.holderApellidoPaterno ?? "",
          apellidoMaterno: asset.holderApellidoMaterno,
        })}${asset.since ? ` desde ${mx(asset.since)}` : ""}`
      : assetStatusLabels[asset.status],
    url: appUrl(ctx, `/app/resguardo/${asset.id}`),
  }));
};

const searchCatalog = async (ctx: WorkiaToolContext, needle: string) => {
  const [positions, areas, sites] = await Promise.all([
    ctx.permissions.has("positions:read") ? listPositions(ctx.companyId) : [],
    ctx.permissions.has("areas:read") ? listAreas(ctx.companyId) : [],
    ctx.permissions.has("sites:read") ? listSites(ctx.companyId) : [],
  ]);

  return [
    ...positions
      .filter((row) => includes(row.name, needle))
      .slice(0, PER_TYPE)
      .map((row) => ({
        id: `position:${row.id}`,
        title: `Puesto: ${row.name}`,
        text: row.active ? "Activo" : "Inactivo",
        url: appUrl(ctx, "/app/catalogo/puestos"),
      })),
    ...areas
      .filter((row) => includes(row.name, needle))
      .slice(0, PER_TYPE)
      .map((row) => ({
        id: `area:${row.id}`,
        title: `Área: ${row.name}`,
        text: row.active ? "Activa" : "Inactiva",
        url: appUrl(ctx, "/app/catalogo/areas"),
      })),
    ...sites
      .filter((row) => includes(row.name, needle))
      .slice(0, PER_TYPE)
      .map((row) => ({
        id: `site:${row.id}`,
        title: `${row.kind === "sucursal" ? "Sucursal" : "Corporativo"}: ${row.name}`,
        text: row.kind,
        url: appUrl(ctx, "/app/catalogo/sucursales"),
      })),
  ];
};

export const searchTool = defineTool({
  name: "search",
  title: "Buscar",
  description: `Búsqueda en toda la empresa: personas (por nombre o correo), sus contratos vigentes, activos (por nombre o identificador), puestos, áreas y sucursales. Devuelve ids «tipo:uuid» para fetch. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("Lo que buscas, p. ej. «LT-014» o «Ana López»."),
  }),
  output: z.object({ results: z.array(resultSchema) }),
  annotations: readAnnotations("Buscar"),
  handler: async ({ query }, ctx) => {
    const needle = query.toLocaleLowerCase("es-MX");
    const [people, assets, catalog] = await Promise.all([
      searchPeople(ctx, query),
      searchAssets(ctx, query),
      searchCatalog(ctx, needle),
    ]);

    return { results: [...people, ...assets, ...catalog] };
  },
});

const requireFor = (ctx: WorkiaToolContext, type: EntityType) => {
  const permission = {
    person: "people:read",
    contract: "contracts:read",
    asset: "assets:read",
    position: "positions:read",
    area: "areas:read",
    site: "sites:read",
    activity: "positions:read",
    template: "contract_templates:read",
  } as const;

  if (!ctx.permissions.has(permission[type])) {
    throw new McpToolError(
      "FORBIDDEN_RBAC",
      `Tu rol en Workia no permite ver este tipo de registro (${permission[type]}).`,
    );
  }
};

const lines = (...values: Array<string | null | undefined | false>) =>
  values.filter(Boolean).join("\n");

const fetchEntity = async (
  ctx: WorkiaToolContext,
  type: EntityType,
  id: string,
) => {
  switch (type) {
    case "person": {
      const person = await getPersonWithRelations(ctx.companyId, id, true);
      if (!person) return null;
      const pii = personPii(person, ctx.piiUnmasked);
      const beneficiaries = ctx.piiUnmasked
        ? await listPersonBeneficiaries(ctx.companyId, person.id)
        : [];
      const address = formatMexicanAddress(person);
      return {
        title: fullName(person),
        text: lines(
          `Estatus: ${personStatusLabels[person.status]}${person.deletedAt ? " (Borrado)" : ""}`,
          person.position && `Puesto: ${person.position.name}`,
          person.area && `Área: ${person.area.name}`,
          person.site && `Ubicación: ${person.site.name}`,
          person.manager && `Jefe: ${fullName(person.manager)}`,
          person.fechaIngreso && `Ingreso: ${mx(person.fechaIngreso)}`,
          pii.rfc && `RFC: ${pii.rfc}`,
          pii.curp && `CURP: ${pii.curp}`,
          pii.nss && `NSS: ${pii.nss}`,
          pii.email && `Correo: ${pii.email}`,
          pii.telefono && `Teléfono: ${pii.telefono}`,
          pii.fecha_nacimiento && `Nacimiento: ${mx(pii.fecha_nacimiento)}`,
          person.schedule &&
            `Horario: ${person.schedule.entrada ?? "—"}–${person.schedule.salida ?? "—"}`,
          ctx.piiUnmasked && address && `Domicilio: ${address}`,
          ctx.piiUnmasked &&
            person.estadoCivil &&
            `Estado civil: ${maritalStatusLabels[person.estadoCivil]}`,
          ctx.piiUnmasked &&
            person.ineClaveElector &&
            `INE: ${person.ineClaveElector}`,
          ctx.piiUnmasked &&
            beneficiaries.length > 0 &&
            `Beneficiarios: ${beneficiaries.map((b) => `${b.nombre} (${b.parentesco}, ${b.porcentaje} %)`).join("; ")}`,
          !ctx.piiUnmasked &&
            address &&
            "Domicilio: capturado (requiere el scope pii)",
        ),
        url: appUrl(ctx, `/app/personas/${person.id}`),
        metadata: {
          resource_type: "person",
          status: person.status,
          pii_masked: pii.pii_masked,
        },
      };
    }
    case "contract": {
      const contract = await getContractById(ctx.companyId, id);
      if (!contract) return null;
      const person = await getPersonWithRelations(
        ctx.companyId,
        contract.personId,
        true,
      );
      const name = person ? fullName(person) : "";
      const body = contract.generatedText ?? "";
      return {
        title: `Contrato ${contract.type} — ${name}`,
        text: lines(
          `Tipo: ${contract.type} · Inicio ${mx(contract.startDate)}${contract.endDate ? ` · Fin ${mx(contract.endDate)}` : ""} · Estado ${contractStatusLabels[contract.status]}`,
          contract.templateName && `Plantilla: ${contract.templateName}`,
          compensacionLine(contract, ctx),
          body && `\n${maskContractText(body, ctx, person, contract)}`,
        ),
        url: appUrl(ctx, `/app/personas/${contract.personId}`),
        metadata: {
          resource_type: "contract",
          status: contract.status,
          pii_masked: !ctx.piiUnmasked,
        },
      };
    }
    case "asset": {
      const asset = await getAssetWithHolder(ctx.companyId, id);
      if (!asset) return null;
      return {
        title: `${asset.name} ${asset.identifier}`,
        text: lines(
          `Categoría: ${asset.category} · Estado: ${assetStatusLabels[asset.status]}`,
          asset.holder && `Resguardante: ${fullName(asset.holder)}`,
          asset.conditionNote && `Condición: ${asset.conditionNote}`,
        ),
        url: appUrl(ctx, `/app/resguardo/${asset.id}`),
        metadata: { resource_type: "asset", status: asset.status },
      };
    }
    case "position": {
      const position = await getPositionById(ctx.companyId, id);
      if (!position || position.deletedAt) return null;
      const activities = await listActivitiesForPosition(
        ctx.companyId,
        position.id,
      );
      return {
        title: `Puesto: ${position.name}`,
        text: lines(
          position.active ? "Activo" : "Inactivo",
          activities.length > 0 &&
            `Actividades: ${activities.map((a) => a.name).join(", ")}`,
        ),
        url: appUrl(ctx, "/app/catalogo/puestos"),
        metadata: { resource_type: "position", active: position.active },
      };
    }
    case "area": {
      const area = await getAreaById(ctx.companyId, id);
      if (!area || area.deletedAt) return null;
      return {
        title: `Área: ${area.name}`,
        text: area.active ? "Activa" : "Inactiva",
        url: appUrl(ctx, "/app/catalogo/areas"),
        metadata: { resource_type: "area", active: area.active },
      };
    }
    case "site": {
      const site = await getSiteById(ctx.companyId, id);
      if (!site || site.deletedAt) return null;
      return {
        title: site.name,
        text: site.kind === "sucursal" ? "Sucursal" : "Corporativo",
        url: appUrl(ctx, "/app/catalogo/sucursales"),
        metadata: { resource_type: "site", kind: site.kind },
      };
    }
    case "activity": {
      const activity = await getActivityById(ctx.companyId, id);
      if (!activity || activity.deletedAt) return null;
      return {
        title: `Actividad: ${activity.name}`,
        text: activity.active ? "Activa" : "Inactiva",
        url: appUrl(ctx, "/app/catalogo/actividades"),
        metadata: { resource_type: "activity", active: activity.active },
      };
    }
    case "template": {
      const template = await getContractTemplateById(ctx.companyId, id);
      if (!template) return null;
      return {
        title: `Plantilla: ${template.name}`,
        text: template.body,
        url: appUrl(ctx, `/app/contratos/plantillas/${template.id}`),
        metadata: { resource_type: "template", active: template.active },
      };
    }
  }
};

export const fetchTool = defineTool({
  name: "fetch",
  title: "Traer documento",
  description: `Trae el documento completo de un resultado de search por su id «tipo:uuid» (person, contract, asset, position, area, site, activity, template). Los datos personales salen enmascarados sin el scope pii. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({
    id: z
      .string()
      .regex(
        new RegExp(`^(${ENTITY_TYPES.join("|")}):[0-9a-f-]{36}$`, "i"),
        "Usa un id de search, p. ej. person:<uuid>.",
      ),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  annotations: readAnnotations("Traer documento"),
  handler: async ({ id }, ctx) => {
    const [rawType, uuid] = id.split(":");
    const type = rawType.toLowerCase() as EntityType;

    requireFor(ctx, type);

    const document = await fetchEntity(ctx, type, uuid.toLowerCase());

    if (!document) {
      throw notFound();
    }

    return { id: `${type}:${uuid.toLowerCase()}`, ...document };
  },
});
