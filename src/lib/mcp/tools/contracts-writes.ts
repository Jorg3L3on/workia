import { z } from "zod";

import {
  createContract,
  getContractById,
  getContractTemplateById,
  markContractNoRenew,
  previewContract,
  renewContract,
} from "@/lib/contracts";
import {
  contractFormSchema,
  contractNoticeWindowLabels,
  contractTypeLabels,
  renewContractFormSchema,
} from "@/lib/contracts/schema";
import { getPersonById } from "@/lib/people";

import { McpToolError, notFound } from "../errors";
import {
  defineWriteTool,
  writeAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import { appUrl, fullName, isoDate, mx, uuid } from "./common";
import {
  assertCanCapture,
  compensacionInput,
  compensacionSummary,
  compensationFormValues,
} from "./compensation";

const NOTICE_WINDOWS = ["1", "2", "3", "6", "no_avisar"] as const;
const TYPES = ["determinado", "indeterminado"] as const;

const contractRef = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  url: z.string(),
});

const toRef = (
  ctx: WorkiaToolContext,
  contract: {
    id: string;
    type: string;
    status: string;
    startDate: string;
    endDate: string | null;
    personId: string;
  },
) => ({
  id: contract.id,
  type: contract.type,
  status: contract.status,
  start_date: contract.startDate,
  end_date: contract.endDate,
  url: appUrl(ctx, `/app/personas/${contract.personId}`),
});

const termsInput = {
  type: z.enum(TYPES),
  start_date: isoDate("Inicio (aaaa-mm-dd)."),
  end_date: isoDate(
    "Fin (aaaa-mm-dd); obligatorio si es determinado.",
  ).optional(),
  notice_window: z
    .enum(NOTICE_WINDOWS)
    .describe("Meses de aviso antes del fin para la bandeja, o no_avisar."),
  template_id: uuid("Plantilla."),
  compensacion: compensacionInput.optional(),
};

const assertTerms = (args: {
  type: string;
  start_date: string;
  end_date?: string;
}) => {
  if (args.type === "determinado" && !args.end_date) {
    throw new McpToolError(
      "VALIDATION",
      "Un contrato determinado necesita end_date.",
    );
  }

  if (args.end_date && args.end_date < args.start_date) {
    throw new McpToolError(
      "VALIDATION",
      "La fecha de fin es anterior al inicio.",
    );
  }
};

const termsSummary = (
  args: {
    type: (typeof TYPES)[number];
    start_date: string;
    end_date?: string;
    notice_window: (typeof NOTICE_WINDOWS)[number];
  },
  templateName: string,
) =>
  `${contractTypeLabels[args.type]} del ${mx(args.start_date)}${args.type === "determinado" && args.end_date ? ` al ${mx(args.end_date)}` : ""} con la plantilla «${templateName}». Aviso: ${contractNoticeWindowLabels[args.notice_window]}.`;

export const issueContractTool = defineWriteTool({
  name: "issue_contract",
  title: "Emitir contrato",
  description:
    "Emite un contrato con una plantilla: congela el texto y el horario de la persona al emitir, igual que la app. CONFLICT si ya tiene un contrato vigente. La vista previa dice qué datos quedarían vacíos en el texto. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:contracts",
  permission: "contracts:create",
  input: z.object({ person_id: uuid("Persona."), ...termsInput }),
  output: z.object({ contract: contractRef }),
  annotations: writeAnnotations("Emitir contrato"),
  preview: async (args, ctx) => {
    assertTerms(args);
    assertCanCapture(ctx, args.compensacion);
    const preview = await previewContract(ctx.companyId, {
      personId: args.person_id,
      templateId: args.template_id,
      type: args.type,
      startDate: args.start_date,
      endDate: args.end_date,
    });

    if (!preview) throw notFound("La persona o la plantilla");
    if (preview.blocking.length > 0)
      throw new McpToolError("CONFLICT", preview.blocking.join(" "));

    return {
      summary: `Contrato para ${fullName(preview.person)}: ${termsSummary(args, preview.template.name)}${args.compensacion ? ` ${compensacionSummary(args.compensacion)}` : ""}`,
      details: { missing_tokens: preview.missingTokens },
      warnings:
        preview.missingTokens.length > 0
          ? [
              `Quedarían vacíos en el texto: ${preview.missingTokens.join(", ")}.`,
            ]
          : undefined,
    };
  },
  handler: async (args, ctx) => {
    assertTerms(args);
    assertCanCapture(ctx, args.compensacion);
    const created = await createContract(
      ctx.companyId,
      contractFormSchema.parse({
        personId: args.person_id,
        type: args.type,
        startDate: args.start_date,
        endDate: args.end_date,
        noticeWindow: args.notice_window,
        templateId: args.template_id,
        ...compensationFormValues(args.compensacion),
      }),
      ctx.userId,
    );

    return { contract: toRef(ctx, created) };
  },
});

const loadVigente = async (ctx: WorkiaToolContext, contractId: string) => {
  const contract = await getContractById(ctx.companyId, contractId);

  if (!contract) throw notFound("El contrato");
  if (contract.status !== "vigente") {
    throw new McpToolError(
      "CONFLICT",
      `El contrato ya no está vigente (${contract.status}).`,
    );
  }

  return contract;
};

export const renewContractTool = defineWriteTool({
  name: "renew_contract",
  title: "Renovar contrato",
  description:
    "Renueva un contrato vigente: el anterior queda «renovado» y se emite el nuevo ligado a él, en un solo paso (si algo falla no cambia nada). Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:contracts",
  permission: "contracts:update",
  input: z.object({
    contract_id: uuid("Contrato vigente a renovar."),
    ...termsInput,
  }),
  output: z.object({
    previous: z.object({ id: z.string(), status: z.string() }),
    contract: contractRef,
  }),
  annotations: writeAnnotations("Renovar contrato", { destructive: true }),
  preview: async (args, ctx) => {
    assertTerms(args);
    assertCanCapture(ctx, args.compensacion);
    const contract = await loadVigente(ctx, args.contract_id);
    const [person, template] = await Promise.all([
      getPersonById(ctx.companyId, contract.personId, true),
      getContractTemplateById(ctx.companyId, args.template_id),
    ]);

    if (!template) throw notFound("La plantilla");

    return {
      summary: `Renovar el contrato de ${person ? fullName(person) : "la persona"} (fin ${mx(contract.endDate) ?? "sin fecha"}): el actual queda renovado y el nuevo es ${termsSummary(args, template.name)} ${args.compensacion ? compensacionSummary(args.compensacion) : contract.salarioDiario === null ? "Sin compensación capturada." : "Conserva la compensación del contrato anterior."}`,
    };
  },
  handler: async (args, ctx) => {
    assertTerms(args);
    assertCanCapture(ctx, args.compensacion);
    const previous = await loadVigente(ctx, args.contract_id);
    const created = await renewContract(
      ctx.companyId,
      renewContractFormSchema.parse({
        contractId: args.contract_id,
        type: args.type,
        startDate: args.start_date,
        endDate: args.end_date,
        noticeWindow: args.notice_window,
        templateId: args.template_id,
        ...compensationFormValues(args.compensacion),
      }),
      ctx.userId,
    );

    return {
      previous: { id: previous.id, status: "renovado" },
      contract: toRef(ctx, created),
    };
  },
});

export const markContractNoRenewTool = defineWriteTool({
  name: "mark_contract_no_renew",
  title: "No renovar contrato",
  description:
    "Registra la decisión de no renovar un contrato vigente; sale de la bandeja de renovación. El motivo queda en la auditoría. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:contracts",
  permission: "contracts:update",
  input: z.object({
    contract_id: uuid("Contrato vigente."),
    motivo: z.string().trim().max(300).optional(),
  }),
  output: z.object({ contract: contractRef }),
  annotations: writeAnnotations("No renovar contrato", { destructive: true }),
  preview: async ({ contract_id, motivo }, ctx) => {
    const contract = await loadVigente(ctx, contract_id);
    const person = await getPersonById(ctx.companyId, contract.personId, true);

    return {
      summary: `No renovar el contrato de ${person ? fullName(person) : "la persona"} (fin ${mx(contract.endDate) ?? "sin fecha"})${motivo ? ` · Motivo: ${motivo}` : ""}.`,
    };
  },
  handler: async ({ contract_id, motivo }, ctx) => {
    await loadVigente(ctx, contract_id);
    const updated = await markContractNoRenew(
      ctx.companyId,
      contract_id,
      ctx.userId,
      motivo,
    );

    return { contract: toRef(ctx, updated) };
  },
});
