import { z } from "zod";

import type {
  ContractNoticeWindow,
  ContractStatus,
  ContractType,
} from "@/lib/db/schema/contracts";
import {
  formatHorarioToken,
  normalizeTimeValue,
  type PersonScheduleValues,
} from "@/lib/people/schema";

export const CONTRACT_TEMPLATE_TOKENS = [
  "nombres",
  "apellido_paterno",
  "apellido_materno",
  "puesto",
  "area",
  "sucursal",
  "rfc",
  "horario",
  "fecha_inicio",
  "fecha_fin",
] as const;

export type ContractTemplateToken = (typeof CONTRACT_TEMPLATE_TOKENS)[number];

export const contractTypeLabels: Record<ContractType, string> = {
  determinado: "Determinado",
  indeterminado: "Indeterminado",
};

export const contractNoticeWindowLabels: Record<ContractNoticeWindow, string> =
  {
    "1": "1 mes antes",
    "2": "2 meses antes",
    "3": "3 meses antes",
    "6": "6 meses antes",
    no_avisar: "No avisar",
  };

export const contractStatusLabels: Record<ContractStatus, string> = {
  vigente: "Vigente",
  renovado: "Renovado",
  no_renovado: "No renovado",
  vencido: "Vencido",
};

export const contractFormSchema = z
  .object({
    personId: z.string().uuid("Selecciona una persona."),
    type: z.enum(["determinado", "indeterminado"]),
    startDate: z.string().min(1, "La fecha de inicio es obligatoria."),
    endDate: z.string().optional(),
    noticeWindow: z.enum(["1", "2", "3", "6", "no_avisar"]),
    templateId: z.string().uuid("Selecciona una plantilla."),
  })
  .superRefine((data, ctx) => {
    if (data.type === "determinado" && !data.endDate?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de fin es obligatoria para contratos determinados.",
        path: ["endDate"],
      });
    }

    if (
      data.type === "determinado" &&
      data.endDate?.trim() &&
      data.startDate > data.endDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de fin debe ser posterior al inicio.",
        path: ["endDate"],
      });
    }
  });

export type ContractFormValues = z.infer<typeof contractFormSchema>;

export const renewContractFormSchema = z
  .object({
    contractId: z.string().uuid(),
    type: z.enum(["determinado", "indeterminado"]),
    startDate: z.string().min(1, "La fecha de inicio es obligatoria."),
    endDate: z.string().optional(),
    noticeWindow: z.enum(["1", "2", "3", "6", "no_avisar"]),
    templateId: z.string().uuid("Selecciona una plantilla."),
  })
  .superRefine((data, ctx) => {
    if (data.type === "determinado" && !data.endDate?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de fin es obligatoria para contratos determinados.",
        path: ["endDate"],
      });
    }
  });

export type RenewContractFormValues = z.infer<typeof renewContractFormSchema>;

export const contractTemplateFormSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  body: z.string().trim().min(1, "El cuerpo de la plantilla es obligatorio."),
  active: z.boolean(),
});

export type ContractTemplateFormValues = z.infer<
  typeof contractTemplateFormSchema
>;

export const formatContractDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

export const noticeWindowToMonths = (
  notice: ContractNoticeWindow,
): number | null => {
  if (notice === "no_avisar") {
    return null;
  }

  return Number.parseInt(notice, 10);
};

export const subtractMonths = (dateStr: string, months: number) => {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
};

export const isContractInRenewalWindow = (input: {
  type: ContractType;
  status: ContractStatus;
  endDate: string | null;
  noticeWindow: ContractNoticeWindow;
  referenceDate?: string;
}) => {
  if (input.type !== "determinado" || input.status !== "vigente") {
    return false;
  }

  if (!input.endDate || input.noticeWindow === "no_avisar") {
    return false;
  }

  const months = noticeWindowToMonths(input.noticeWindow);

  if (!months) {
    return false;
  }

  const today = input.referenceDate ?? new Date().toISOString().slice(0, 10);
  const windowStart = subtractMonths(input.endDate, months);

  return today >= windowStart && today <= input.endDate;
};

export type TemplateFillContext = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string | null;
  puesto?: string | null;
  area?: string | null;
  sucursal?: string | null;
  rfc?: string | null;
  horario?: string | null;
  fechaInicio: string;
  fechaFin?: string | null;
};

export type ContractScheduleSnapshot = {
  scheduleEntrada: string | null;
  scheduleSalidaComer: string | null;
  scheduleRegresoComer: string | null;
  scheduleSalida: string | null;
};

export const buildContractScheduleSnapshot = (
  schedule?: PersonScheduleValues | null,
): ContractScheduleSnapshot => ({
  scheduleEntrada: normalizeTimeValue(schedule?.entrada),
  scheduleSalidaComer: normalizeTimeValue(schedule?.salidaComer),
  scheduleRegresoComer: normalizeTimeValue(schedule?.regresoComer),
  scheduleSalida: normalizeTimeValue(schedule?.salida),
});

export const fillContractTemplate = (
  body: string,
  context: TemplateFillContext,
) => {
  const replacements: Record<ContractTemplateToken, string> = {
    nombres: context.nombres,
    apellido_paterno: context.apellidoPaterno,
    apellido_materno: context.apellidoMaterno ?? "",
    puesto: context.puesto ?? "",
    area: context.area ?? "",
    sucursal: context.sucursal ?? "",
    rfc: context.rfc ?? "",
    horario: context.horario?.trim() || formatHorarioToken(null),
    fecha_inicio: formatContractDate(context.fechaInicio),
    fecha_fin: formatContractDate(context.fechaFin),
  };

  return body.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
    if (token in replacements) {
      return replacements[token as ContractTemplateToken];
    }

    return match;
  });
};
