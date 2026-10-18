import { z } from "zod";

import { formatDateMx } from "@/lib/format/date";
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
import {
  readStoredBlocks,
  type ScheduleBlock,
  type WeekDay,
} from "@/lib/people/schedule-blocks";

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

export const PAYMENT_METHODS = ["transferencia", "efectivo", "cheque"] as const;
export const PAY_FREQUENCIES = ["semanal", "quincenal", "mensual"] as const;

export const paymentMethodLabels: Record<
  (typeof PAYMENT_METHODS)[number],
  string
> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cheque: "Cheque",
};

export const payFrequencyLabels: Record<
  (typeof PAY_FREQUENCIES)[number],
  string
> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
};

/** Days per month used to derive the monthly salary from the daily one (D-19). */
export const MONTHLY_SALARY_FACTOR = 30.4;

export const monthlySalary = (daily: number) =>
  Math.round(daily * MONTHLY_SALARY_FACTOR * 100) / 100;

/** Compensation of a contract (WRK-I5-2). All optional; with a salary, method and frequency too. */
export const compensationFields = {
  salarioDiario: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .positive("El salario diario debe ser mayor a 0")
        .max(100000),
    ])
    .optional(),
  formaPago: z.enum(PAYMENT_METHODS).optional().or(z.literal("")),
  periodicidadPago: z.enum(PAY_FREQUENCIES).optional().or(z.literal("")),
  diaPago: z.string().trim().max(60).optional().or(z.literal("")),
};

const refineCompensation = (
  data: {
    salarioDiario?: number | "";
    formaPago?: string;
    periodicidadPago?: string;
  },
  ctx: z.RefinementCtx,
) => {
  if (typeof data.salarioDiario === "number") {
    if (!data.formaPago) {
      ctx.addIssue({
        code: "custom",
        message: "Indica la forma de pago.",
        path: ["formaPago"],
      });
    }

    if (!data.periodicidadPago) {
      ctx.addIssue({
        code: "custom",
        message: "Indica la periodicidad de pago.",
        path: ["periodicidadPago"],
      });
    }
  }
};

export type CompensationValues = {
  salarioDiario: string | null;
  salarioMensual: string | null;
  formaPago: (typeof PAYMENT_METHODS)[number] | null;
  periodicidadPago: (typeof PAY_FREQUENCIES)[number] | null;
  diaPago: string | null;
};

/** The compensation columns to store, or none when no salary was given. */
export const compensationValues = (input: {
  salarioDiario?: number | "";
  formaPago?: string;
  periodicidadPago?: string;
  diaPago?: string;
}): CompensationValues =>
  typeof input.salarioDiario === "number"
    ? {
        salarioDiario: input.salarioDiario.toFixed(2),
        salarioMensual: monthlySalary(input.salarioDiario).toFixed(2),
        formaPago: (input.formaPago || null) as
          (typeof PAYMENT_METHODS)[number] | null,
        periodicidadPago: (input.periodicidadPago || null) as
          (typeof PAY_FREQUENCIES)[number] | null,
        diaPago: input.diaPago?.trim() || null,
      }
    : {
        salarioDiario: null,
        salarioMensual: null,
        formaPago: null,
        periodicidadPago: null,
        diaPago: null,
      };

export const contractFormSchema = z
  .object({
    personId: z.string().uuid("Selecciona una persona."),
    type: z.enum(["determinado", "indeterminado"]),
    startDate: z.string().min(1, "La fecha de inicio es obligatoria."),
    endDate: z.string().optional(),
    noticeWindow: z.enum(["1", "2", "3", "6", "no_avisar"]),
    templateId: z.string().uuid("Selecciona una plantilla."),
    ...compensationFields,
  })
  .superRefine((data, ctx) => {
    refineCompensation(data, ctx);

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
    ...compensationFields,
  })
  .superRefine((data, ctx) => {
    refineCompensation(data, ctx);

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

export const formatContractDate = formatDateMx;

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
  scheduleBlocks: ScheduleBlock[] | null;
  scheduleRestDay: WeekDay | null;
};

/** The person's schedule frozen at emission: the four fields and, when it has them, its blocks (WRK-I5-3). */
export const buildContractScheduleSnapshot = (
  schedule?: PersonScheduleValues | null,
): ContractScheduleSnapshot => {
  const blocks = readStoredBlocks(schedule?.blocks, schedule?.restDay);
  const hasBlocks = Boolean(blocks && blocks.bloques.length > 0);

  return {
    scheduleEntrada: normalizeTimeValue(schedule?.entrada),
    scheduleSalidaComer: normalizeTimeValue(schedule?.salidaComer),
    scheduleRegresoComer: normalizeTimeValue(schedule?.regresoComer),
    scheduleSalida: normalizeTimeValue(schedule?.salida),
    scheduleBlocks: hasBlocks ? blocks!.bloques : null,
    scheduleRestDay: hasBlocks ? blocks!.diaDescanso : null,
  };
};

/** A contract's frozen schedule as text: its blocks, or the four simple fields. */
export const contractScheduleText = (contract: {
  scheduleEntrada: string | null;
  scheduleSalidaComer: string | null;
  scheduleRegresoComer: string | null;
  scheduleSalida: string | null;
  scheduleBlocks: unknown;
  scheduleRestDay: string | null;
}) =>
  formatHorarioToken({
    entrada: contract.scheduleEntrada,
    salidaComer: contract.scheduleSalidaComer,
    regresoComer: contract.scheduleRegresoComer,
    salida: contract.scheduleSalida,
    blocks: contract.scheduleBlocks,
    restDay: contract.scheduleRestDay as WeekDay | null,
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
