import { z } from "zod";

import {
  approveOnboardingStep,
  getOnboardingById,
  findBlockingOnboarding,
  getOnboardingByPerson,
  OnboardingError,
  startOnboarding,
} from "@/lib/onboarding";
import {
  INFONAVIT_DISCOUNT_TYPES,
  missingChecklist,
  ONBOARDING_CHECKLIST,
  onboardingChecklistLabels,
  onboardingFormSchema,
  onboardingStageLabels,
} from "@/lib/onboarding/schema";
import type { Onboarding } from "@/lib/db/schema";

import { McpToolError, notFound } from "../errors";
import {
  defineTool,
  defineWriteTool,
  readAnnotations,
  writeAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import {
  appUrl,
  fullName,
  personRefSchema,
  requirePermission,
  uuid,
} from "./common";

/** Hiring from HR to Payroll over the connector (WRK-I1-14). */
const altaSchema = z.object({
  id: z.string(),
  person: personRefSchema,
  stage: z.string(),
  stage_label: z.string(),
  checklist: z.record(z.string(), z.boolean()),
  missing: z.array(z.string()),
  infonavit: z
    .object({
      capturado: z.boolean(),
      credito: z.string().nullable().optional(),
      tipo_descuento: z.string().nullable().optional(),
      factor: z.number().nullable().optional(),
    })
    .describe("Montos y número de crédito sólo con el scope pii."),
  fonacot: z.object({
    capturado: z.boolean(),
    credito: z.string().nullable().optional(),
    descuento: z.number().nullable().optional(),
  }),
  rh_aprobado: z.boolean(),
  nominas_aprobado: z.boolean(),
  rechazo: z.string().nullable(),
  url: z.string(),
});

const toAlta = (
  ctx: WorkiaToolContext,
  onboarding: Onboarding,
  person: {
    id: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  },
) => ({
  id: onboarding.id,
  person: { id: person.id, nombre_completo: fullName(person) },
  stage: onboarding.stage,
  stage_label: onboardingStageLabels[onboarding.stage],
  checklist: Object.fromEntries(
    ONBOARDING_CHECKLIST.map((item) => [
      item,
      Boolean(onboarding.checklist[item]),
    ]),
  ),
  missing: missingChecklist(onboarding.checklist),
  infonavit: ctx.piiUnmasked
    ? {
        capturado: onboarding.infonavitCredito !== null,
        credito: onboarding.infonavitCredito,
        tipo_descuento: onboarding.infonavitTipoDescuento,
        factor:
          onboarding.infonavitFactor === null
            ? null
            : Number(onboarding.infonavitFactor),
      }
    : { capturado: onboarding.infonavitCredito !== null },
  fonacot: ctx.piiUnmasked
    ? {
        capturado: onboarding.fonacotCredito !== null,
        credito: onboarding.fonacotCredito,
        descuento:
          onboarding.fonacotDescuento === null
            ? null
            : Number(onboarding.fonacotDescuento),
      }
    : { capturado: onboarding.fonacotCredito !== null },
  rh_aprobado: onboarding.rhApprovedBy !== null,
  nominas_aprobado: onboarding.payrollApprovedBy !== null,
  rechazo: onboarding.rejectedReason,
  url: appUrl(ctx, `/app/altas/${onboarding.id}`),
});

const asToolError = (error: unknown): never => {
  if (error instanceof OnboardingError) {
    throw new McpToolError(
      /no encontrad/.test(error.message) ? "NOT_FOUND" : "CONFLICT",
      error.message,
    );
  }

  throw error;
};

export const getOnboardingTool = defineTool({
  name: "get_onboarding",
  title: "Ver alta",
  description:
    "Estado de un alta RH → Nóminas por person_id u onboarding_id: etapa, checklist, lo que falta, Infonavit/Fonacot (número y montos sólo con el scope pii) y quién ya aprobó.",
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({
    onboarding_id: uuid("Alta.").optional(),
    person_id: uuid("Persona.").optional(),
  }),
  output: z.object({ alta: altaSchema }),
  annotations: readAnnotations("Ver alta"),
  handler: async ({ onboarding_id, person_id }, ctx) => {
    if (!onboarding_id && !person_id) {
      throw new McpToolError("VALIDATION", "Envía onboarding_id o person_id.");
    }

    const id =
      onboarding_id ??
      (await getOnboardingByPerson(ctx.companyId, person_id!))?.id;
    const row = id ? await getOnboardingById(ctx.companyId, id) : null;

    if (!row) throw notFound("El alta");

    return { alta: toAlta(ctx, row.onboarding, row.person) };
  },
});

const captureInput = {
  checklist: z
    .partialRecord(z.enum(ONBOARDING_CHECKLIST), z.boolean())
    .optional()
    .describe(`Documentos entregados: ${ONBOARDING_CHECKLIST.join(", ")}.`),
  infonavit: z
    .object({
      credito: z.string().trim().max(40),
      tipo_descuento: z.enum(INFONAVIT_DISCOUNT_TYPES),
      factor: z.number().min(0),
    })
    .optional()
    .describe("Sólo con el scope pii."),
  fonacot: z
    .object({
      credito: z.string().trim().max(40),
      descuento: z.number().min(0),
    })
    .optional()
    .describe("Sólo con el scope pii."),
};

export const startOnboardingTool = defineWriteTool({
  name: "start_onboarding",
  title: "Iniciar alta",
  description:
    "Inicia el alta RH → Nóminas de una persona activa que ya tiene expediente (créalo antes con create_person), con el checklist e Infonavit/Fonacot si ya los tienes. Queda en «Captura RH»; luego approve_onboarding_step. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({ person_id: uuid("Persona."), ...captureInput }),
  output: z.object({ alta: altaSchema }),
  annotations: writeAnnotations("Iniciar alta"),
  preview: async (args, ctx) => {
    const capture = parseCapture(args, ctx);

    if (await findBlockingOnboarding(ctx.companyId, args.person_id)) {
      throw new McpToolError("CONFLICT", "Esta persona ya tiene un alta.");
    }

    const missing = missingChecklist(capture.checklist);

    return {
      summary: `Iniciar el alta de la persona con ${7 - missing.length}/7 documentos del checklist.`,
      warnings:
        missing.length > 0
          ? [
              `Faltan: ${missing.map((item) => onboardingChecklistLabels[item]).join(", ")}. RH no puede aprobar hasta completarlos.`,
            ]
          : undefined,
    };
  },
  handler: async (args, ctx) => {
    const capture = parseCapture(args, ctx);
    const created = await startOnboarding(
      ctx.companyId,
      args.person_id,
      ctx.userId,
      capture,
    ).catch(asToolError);
    const row = await getOnboardingById(ctx.companyId, created.id);

    return { alta: toAlta(ctx, row!.onboarding, row!.person) };
  },
});

const parseCapture = (
  args: {
    checklist?: Partial<Record<(typeof ONBOARDING_CHECKLIST)[number], boolean>>;
    infonavit?: {
      credito: string;
      tipo_descuento: (typeof INFONAVIT_DISCOUNT_TYPES)[number];
      factor: number;
    };
    fonacot?: { credito: string; descuento: number };
  },
  ctx: WorkiaToolContext,
) => {
  if ((args.infonavit || args.fonacot) && !ctx.piiUnmasked) {
    throw new McpToolError(
      "FORBIDDEN_SCOPE",
      "Para capturar Infonavit o Fonacot la conexión necesita el scope pii.",
      { details: { required_scope: "pii" } },
    );
  }

  const parsed = onboardingFormSchema.safeParse({
    checklist: args.checklist ?? {},
    infonavitCredito: args.infonavit?.credito,
    infonavitTipoDescuento: args.infonavit?.tipo_descuento,
    infonavitFactor: args.infonavit?.factor,
    fonacotCredito: args.fonacot?.credito,
    fonacotDescuento: args.fonacot?.descuento,
  });

  if (!parsed.success) {
    throw new McpToolError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Revisa la captura del alta.",
    );
  }

  return parsed.data;
};

export const approveOnboardingStepTool = defineWriteTool({
  name: "approve_onboarding_step",
  title: "Aprobar etapa del alta",
  description:
    "Da el visto bueno de la etapa actual de un alta: en «Captura RH» (people:update, checklist completo) la pasa a Nóminas; en «Pendiente Nóminas» (permiso payroll:approve) la completa. Doble visto bueno: quien aprobó RH no puede aprobar Nóminas (CONFLICT). Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({ onboarding_id: uuid("Alta.") }),
  output: z.object({ alta: altaSchema }),
  annotations: writeAnnotations("Aprobar etapa del alta"),
  preview: async ({ onboarding_id }, ctx) => {
    const row = await loadForApproval(ctx, onboarding_id);
    const name = fullName(row.person);

    return {
      summary:
        row.onboarding.stage === "rh_captura"
          ? `Visto bueno de RH para el alta de ${name}: pasa a Nóminas.`
          : `Visto bueno de Nóminas para el alta de ${name}: queda completa.`,
    };
  },
  handler: async ({ onboarding_id }, ctx) => {
    await loadForApproval(ctx, onboarding_id);
    await approveOnboardingStep(ctx.companyId, onboarding_id, ctx.userId).catch(
      asToolError,
    );
    const row = await getOnboardingById(ctx.companyId, onboarding_id);

    return { alta: toAlta(ctx, row!.onboarding, row!.person) };
  },
});

/** The alta, checked for the stage's permission and the two-approvers rule. */
const loadForApproval = async (ctx: WorkiaToolContext, id: string) => {
  const row = await getOnboardingById(ctx.companyId, id);

  if (!row) throw notFound("El alta");

  const { onboarding } = row;

  if (onboarding.stage === "completo" || onboarding.stage === "rechazado") {
    throw new McpToolError("CONFLICT", "El alta ya está cerrada.");
  }

  if (onboarding.stage === "pendiente_nominas") {
    requirePermission(ctx, "payroll:approve");

    if (onboarding.rhApprovedBy === ctx.userId) {
      throw new McpToolError(
        "CONFLICT",
        "La misma persona no puede aprobar las dos etapas del alta.",
      );
    }
  } else {
    const missing = missingChecklist(onboarding.checklist);

    if (missing.length > 0) {
      throw new McpToolError(
        "CONFLICT",
        `Falta en el checklist: ${missing.map((item) => onboardingChecklistLabels[item]).join(", ")}.`,
      );
    }
  }

  return row;
};
