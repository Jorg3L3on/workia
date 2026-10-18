import { z } from "zod";

import {
  getContractById,
  getContractTemplateById,
  listContractsByPerson,
  listContractsKeyset,
  listContractTemplates,
  listExpiringContracts,
  listRenewalTrayItems,
  previewContract,
  templateTokensUsed,
} from "@/lib/contracts";
import {
  CONTRACT_TEMPLATE_TOKENS,
  contractStatusLabels,
  isContractInRenewalWindow,
} from "@/lib/contracts/schema";
import { getPersonById } from "@/lib/people";

import {
  cursorSchema,
  decodeCursor,
  filtersHash,
  limitSchema,
  pageOf,
} from "../cursor";
import { McpToolError, notFound } from "../errors";
import { maskText } from "../mask";
import { compensacion, compensacionSchema } from "./compensation";
import { defineTool, readAnnotations } from "../run-tool";
import {
  appUrl,
  FREE_TEXT_NOTE,
  fullName,
  isoDate,
  mx,
  nextCursorSchema,
  personRefSchema,
  requirePermission,
  uuid,
} from "./common";

const CONTRACT_STATUSES = [
  "vigente",
  "renovado",
  "no_renovado",
  "vencido",
] as const;
const CONTRACT_TYPES = ["determinado", "indeterminado"] as const;

const scheduleSchema = z.object({
  entrada: z.string().nullable(),
  salida_comer: z.string().nullable(),
  regreso_comer: z.string().nullable(),
  salida: z.string().nullable(),
});

export const listContractsTool = defineTool({
  name: "list_contracts",
  title: "Listar contratos",
  description:
    "Contratos filtrables por persona, estado, tipo y rango de fecha de fin, ordenados por fecha de fin (los indeterminados al final). Sin el texto del contrato (ver get_contract).",
  kind: "read",
  scope: "read",
  permission: "contracts:read",
  input: z.object({
    person_id: uuid("Sólo los contratos de esta persona.").optional(),
    status: z.array(z.enum(CONTRACT_STATUSES)).max(4).optional(),
    type: z.enum(CONTRACT_TYPES).optional(),
    end_date_from: isoDate("Fin desde (aaaa-mm-dd).").optional(),
    end_date_to: isoDate("Fin hasta (aaaa-mm-dd).").optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        person: personRefSchema,
        type: z.string(),
        status: z.string(),
        status_label: z.string(),
        start_date: z.string(),
        start_date_mx: z.string().nullable(),
        end_date: z.string().nullable(),
        end_date_mx: z.string().nullable(),
        notice_window: z.string(),
        template_name: z.string().nullable(),
        previous_contract_id: z.string().nullable(),
      }),
    ),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Listar contratos"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    const hash = filtersHash("list_contracts", filters);
    const rows = await listContractsKeyset(ctx.companyId, {
      personId: filters.person_id,
      statuses: filters.status,
      type: filters.type,
      endDateFrom: filters.end_date_from,
      endDateTo: filters.end_date_to,
      after: decodeCursor(cursor, hash),
      limit,
    });
    const page = pageOf(rows, limit, hash, (row) => row.sortKey);

    return {
      items: page.items.map((row) => ({
        id: row.id,
        person: { id: row.personId, nombre_completo: fullName(row) },
        type: row.type,
        status: row.status,
        status_label: contractStatusLabels[row.status],
        start_date: row.startDate,
        start_date_mx: mx(row.startDate),
        end_date: row.endDate,
        end_date_mx: mx(row.endDate),
        notice_window: row.noticeWindow,
        template_name: row.templateName,
        previous_contract_id: row.previousContractId,
      })),
      next_cursor: page.next_cursor,
    };
  },
});

export const listExpiringContractsTool = defineTool({
  name: "list_expiring_contracts",
  title: "Contratos por vencer",
  description:
    "«¿Qué contratos vencen en N días?»: contratos determinados vigentes cuya fecha de fin cae entre hoy (México) y hoy + within_days, sin importar el aviso. Incluye días restantes y si ya están en la bandeja de renovación.",
  kind: "read",
  scope: "read",
  permission: "contracts:read",
  input: z.object({
    within_days: z.number().int().min(1).max(365).default(30),
    site_id: uuid("Sólo personas de esta sucursal.").optional(),
    area_id: uuid("Sólo personas de esta área.").optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    as_of: z.string(),
    as_of_mx: z.string().nullable(),
    items: z.array(
      z.object({
        contract_id: z.string(),
        person: personRefSchema,
        area: z.string().nullable(),
        sucursal: z.string().nullable(),
        end_date: z.string(),
        end_date_mx: z.string().nullable(),
        days_left: z.number().int(),
        notice_window: z.string(),
        in_renewal_tray: z.boolean(),
      }),
    ),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Contratos por vencer"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    // "Today" is part of the list: a cursor from yesterday does not continue today.
    const hash = filtersHash("list_expiring_contracts", {
      ...filters,
      today: ctx.today,
    });
    const rows = await listExpiringContracts(ctx.companyId, {
      today: ctx.today,
      withinDays: filters.within_days,
      siteId: filters.site_id,
      areaId: filters.area_id,
      after: decodeCursor(cursor, hash),
      limit,
    });
    const page = pageOf(rows, limit, hash, (row) => row.endDate!);
    const dayMs = 86_400_000;

    return {
      as_of: ctx.today,
      as_of_mx: mx(ctx.today),
      items: page.items.map((row) => ({
        contract_id: row.id,
        person: { id: row.personId, nombre_completo: fullName(row) },
        area: row.areaName ?? null,
        sucursal: row.siteName ?? null,
        end_date: row.endDate!,
        end_date_mx: mx(row.endDate),
        days_left: Math.round(
          (Date.parse(`${row.endDate}T00:00:00Z`) -
            Date.parse(`${ctx.today}T00:00:00Z`)) /
            dayMs,
        ),
        notice_window: row.noticeWindow,
        in_renewal_tray: isContractInRenewalWindow({
          type: row.type,
          status: row.status,
          endDate: row.endDate,
          noticeWindow: row.noticeWindow,
          referenceDate: ctx.today,
        }),
      })),
      next_cursor: page.next_cursor,
    };
  },
});

export const listRenewalTrayTool = defineTool({
  name: "list_renewal_tray",
  title: "Bandeja de renovación",
  description:
    "La bandeja de renovación de Workia tal cual: contratos determinados vigentes dentro de su ventana de aviso (1, 2, 3 o 6 meses antes del fin; «no avisar» queda fuera), por fecha de fin.",
  kind: "read",
  scope: "read",
  permission: "contracts:read",
  input: z.object({
    reference_date: isoDate(
      "Fecha de referencia (por defecto hoy en México).",
    ).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: z.object({
    as_of: z.string(),
    as_of_mx: z.string().nullable(),
    count: z.number().int(),
    items: z.array(
      z.object({
        contract_id: z.string(),
        person_id: z.string(),
        person_name: z.string(),
        area_name: z.string().nullable(),
        end_date: z.string(),
        end_date_mx: z.string().nullable(),
        notice_window: z.string(),
        url: z.string(),
      }),
    ),
    truncated: z.boolean(),
  }),
  annotations: readAnnotations("Bandeja de renovación"),
  handler: async ({ reference_date, limit }, ctx) => {
    const asOf = reference_date ?? ctx.today;
    const items = await listRenewalTrayItems(ctx.companyId, asOf);

    return {
      as_of: asOf,
      as_of_mx: mx(asOf),
      count: items.length,
      items: items.slice(0, limit).map((item) => ({
        contract_id: item.contract.id,
        person_id: item.personId,
        person_name: item.personName,
        area_name: item.areaName,
        end_date: item.endDate,
        end_date_mx: mx(item.endDate),
        notice_window: item.noticeWindow,
        url: appUrl(ctx, `/app/personas/${item.personId}`),
      })),
      truncated: items.length > limit,
    };
  },
});

export const getContractTool = defineTool({
  name: "get_contract",
  title: "Ver contrato",
  description: `Detalle de un contrato: horario y compensación congelados al emitir (los montos sólo con el scope pii y compensation:read), cadena de renovaciones y, si include_text, el texto generado. El texto lleva RFC: sale enmascarado sin el scope pii. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "contracts:read",
  input: z.object({
    contract_id: uuid("Id del contrato."),
    include_text: z.boolean().default(false),
    include_history: z.boolean().default(true),
  }),
  output: z.object({
    contract: z.object({
      id: z.string(),
      person: personRefSchema,
      type: z.string(),
      status: z.string(),
      status_label: z.string(),
      start_date: z.string(),
      start_date_mx: z.string().nullable(),
      end_date: z.string().nullable(),
      end_date_mx: z.string().nullable(),
      notice_window: z.string(),
      template_name: z.string().nullable(),
      previous_contract_id: z.string().nullable(),
      schedule: scheduleSchema,
      compensacion: compensacionSchema,
      generated_text: z.string().optional(),
      pii_masked: z.boolean(),
      url: z.string(),
    }),
    history: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          status: z.string(),
          start_date: z.string(),
          end_date: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  annotations: readAnnotations("Ver contrato"),
  handler: async ({ contract_id, include_text, include_history }, ctx) => {
    const contract = await getContractById(ctx.companyId, contract_id);

    if (!contract) {
      throw notFound("El contrato");
    }

    const [person, chain] = await Promise.all([
      getPersonById(ctx.companyId, contract.personId, true),
      include_history
        ? listContractsByPerson(ctx.companyId, contract.personId)
        : null,
    ]);
    const text = contract.generatedText ?? "";

    return {
      contract: {
        id: contract.id,
        person: {
          id: contract.personId,
          nombre_completo: person ? fullName(person) : "",
        },
        type: contract.type,
        status: contract.status,
        status_label: contractStatusLabels[contract.status],
        start_date: contract.startDate,
        start_date_mx: mx(contract.startDate),
        end_date: contract.endDate,
        end_date_mx: mx(contract.endDate),
        notice_window: contract.noticeWindow,
        template_name: contract.templateName,
        previous_contract_id: contract.previousContractId,
        schedule: {
          entrada: contract.scheduleEntrada,
          salida_comer: contract.scheduleSalidaComer,
          regreso_comer: contract.scheduleRegresoComer,
          salida: contract.scheduleSalida,
        },
        compensacion: compensacion(contract, ctx),
        ...(include_text
          ? {
              generated_text: ctx.piiUnmasked
                ? text
                : maskText(text, [person?.rfc, person?.curp, person?.nss]),
            }
          : {}),
        pii_masked: !ctx.piiUnmasked,
        url: appUrl(ctx, `/app/personas/${contract.personId}`),
      },
      ...(chain
        ? {
            history: chain
              .filter((item) => item.id !== contract.id)
              .map((item) => ({
                id: item.id,
                type: item.type,
                status: item.status,
                start_date: item.startDate,
                end_date: item.endDate,
              })),
          }
        : {}),
    };
  },
});

export const listContractTemplatesTool = defineTool({
  name: "list_contract_templates",
  title: "Plantillas de contrato",
  description: `Plantillas de contrato y los tokens que Workia sabe llenar ({{nombres}}, {{puesto}}, {{rfc}}, {{horario}}…). ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "contract_templates:read",
  input: z.object({
    include_inactive: z.boolean().default(false),
    include_body: z.boolean().default(false),
  }),
  output: z.object({
    tokens: z.array(z.string()),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        active: z.boolean(),
        tokens_used: z.array(z.string()),
        body: z.string().optional(),
      }),
    ),
  }),
  annotations: readAnnotations("Plantillas de contrato"),
  handler: async ({ include_inactive, include_body }, ctx) => {
    const templates = await listContractTemplates(
      ctx.companyId,
      include_inactive,
    );

    return {
      tokens: [...CONTRACT_TEMPLATE_TOKENS],
      items: templates.map((template) => ({
        id: template.id,
        name: template.name,
        active: template.active,
        tokens_used: templateTokensUsed(template.body),
        ...(include_body ? { body: template.body } : {}),
      })),
    };
  },
});

export const previewContractTool = defineTool({
  name: "preview_contract",
  title: "Vista previa de contrato",
  description:
    "Simula la emisión de un contrato sin guardar nada: el texto que saldría, los tokens que quedarían vacíos (p. ej. persona sin horario o sin RFC) y lo que impediría emitirlo (contrato vigente, falta fecha de fin). El RFC del texto sale enmascarado sin el scope pii.",
  kind: "read",
  scope: "read",
  permission: "contracts:read",
  input: z.object({
    person_id: uuid("Persona."),
    template_id: uuid("Plantilla."),
    type: z.enum(CONTRACT_TYPES),
    start_date: isoDate("Inicio (aaaa-mm-dd)."),
    end_date: isoDate(
      "Fin (aaaa-mm-dd), obligatorio si es determinado.",
    ).optional(),
  }),
  output: z.object({
    generated_text: z.string(),
    missing_tokens: z.array(z.string()),
    blocking: z.array(z.string()),
    schedule_snapshot: scheduleSchema,
    pii_masked: z.boolean(),
  }),
  annotations: {
    ...readAnnotations("Vista previa de contrato"),
    idempotentHint: true,
  },
  handler: async (args, ctx) => {
    requirePermission(ctx, "contract_templates:read");

    if (args.end_date && args.end_date < args.start_date) {
      throw new McpToolError(
        "VALIDATION",
        "La fecha de fin es anterior al inicio.",
      );
    }

    if (!(await getContractTemplateById(ctx.companyId, args.template_id))) {
      throw notFound("La plantilla");
    }

    const preview = await previewContract(ctx.companyId, {
      personId: args.person_id,
      templateId: args.template_id,
      type: args.type,
      startDate: args.start_date,
      endDate: args.end_date,
    });

    if (!preview) {
      throw notFound("La persona");
    }

    return {
      generated_text: ctx.piiUnmasked
        ? preview.generatedText
        : maskText(preview.generatedText, [
            preview.person.rfc,
            preview.person.curp,
            preview.person.nss,
          ]),
      missing_tokens: preview.missingTokens,
      blocking: preview.blocking,
      schedule_snapshot: {
        entrada: preview.scheduleSnapshot.scheduleEntrada,
        salida_comer: preview.scheduleSnapshot.scheduleSalidaComer,
        regreso_comer: preview.scheduleSnapshot.scheduleRegresoComer,
        salida: preview.scheduleSnapshot.scheduleSalida,
      },
      pii_masked: !ctx.piiUnmasked,
    };
  },
});
