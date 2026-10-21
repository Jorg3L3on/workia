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
import { formatSeniority } from "@/lib/people/seniority";
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
  // Official templates (WRK-I5-5).
  "curp",
  "nss",
  "ine",
  "domicilio",
  "estado_civil",
  "nacionalidad",
  "salario_diario",
  "salario_mensual",
  "forma_pago",
  "periodicidad",
  "fecha_ingreso",
  "antiguedad",
  "empresa",
  "empresa_razon_social",
  "empresa_rfc",
] as const;

export type ContractTemplateToken = (typeof CONTRACT_TEMPLATE_TOKENS)[number];

/** What each token prints, for the templates help and the connector. */
export const contractTemplateTokenLabels: Record<
  ContractTemplateToken,
  string
> = {
  nombres: "Nombre(s)",
  apellido_paterno: "Apellido paterno",
  apellido_materno: "Apellido materno",
  puesto: "Puesto",
  area: "Área",
  sucursal: "Sucursal o corporativo",
  rfc: "RFC",
  horario: "Horario por bloques en texto",
  fecha_inicio: "Inicio del contrato (dd/mm/aaaa)",
  fecha_fin: "Fin del contrato (dd/mm/aaaa)",
  curp: "CURP",
  nss: "NSS",
  ine: "Clave de elector (INE)",
  domicilio: "Domicilio completo",
  estado_civil: "Estado civil",
  nacionalidad: "Nacionalidad",
  salario_diario: "Salario diario ($)",
  salario_mensual: "Salario mensual ($, diario × 30.4)",
  forma_pago: "Forma de pago",
  periodicidad: "Periodicidad de pago",
  fecha_ingreso: "Fecha de ingreso original (dd/mm/aaaa)",
  antiguedad: "Antigüedad al inicio del contrato",
  empresa: "Nombre comercial de la empresa",
  empresa_razon_social: "Razón social de la empresa",
  empresa_rfc: "RFC de la empresa",
};

/** Tokens with personal identifiers: masked over the connector without pii. */
export const PII_TEMPLATE_TOKENS: readonly ContractTemplateToken[] = [
  "rfc",
  "curp",
  "nss",
  "ine",
  "domicilio",
];

/** Tokens with the contract's compensation: shown only with compensation:read. */
export const COMPENSATION_TEMPLATE_TOKENS: readonly ContractTemplateToken[] = [
  "salario_diario",
  "salario_mensual",
  "forma_pago",
  "periodicidad",
];

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
  terminado: "Terminado",
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

export const RENEWAL_DECISIONS = [
  "renovar_indeterminado",
  "renovar_determinado",
  "no_renovar",
] as const;

export type RenewalDecision = (typeof RENEWAL_DECISIONS)[number];

export const renewalDecisionLabels: Record<RenewalDecision, string> = {
  renovar_indeterminado: "Renovar por tiempo indeterminado",
  renovar_determinado: "Renovar por tiempo determinado",
  no_renovar: "No renovar",
};

/**
 * One renewal decision from the tray (WRK-I5-6). Renewing needs a template
 * (and an end date when fixed-term); not renewing needs a reason. Position
 * and compensation are optional: absent keeps the current ones.
 */
export const renewalDecisionSchema = z
  .object({
    contractId: z.uuid(),
    decision: z.enum(RENEWAL_DECISIONS),
    motivo: z.string().trim().max(500).optional(),
    templateId: z.union([z.uuid(), z.literal("")]).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    noticeWindow: z.enum(["1", "2", "3", "6", "no_avisar"]).optional(),
    newPositionId: z.union([z.uuid(), z.literal("")]).optional(),
    ...compensationFields,
  })
  .superRefine((data, ctx) => {
    if (data.decision === "no_renovar") {
      if (!data.motivo) {
        ctx.addIssue({
          code: "custom",
          message: "Indica el motivo para no renovar.",
          path: ["motivo"],
        });
      }
      return;
    }

    refineCompensation(data, ctx);

    if (!data.templateId) {
      ctx.addIssue({
        code: "custom",
        message: "Selecciona una plantilla.",
        path: ["templateId"],
      });
    }

    if (data.decision === "renovar_determinado" && !data.endDate?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de fin es obligatoria para contratos determinados.",
        path: ["endDate"],
      });
    }

    if (
      data.startDate &&
      data.endDate &&
      data.decision === "renovar_determinado" &&
      data.endDate < data.startDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de fin es anterior al inicio.",
        path: ["endDate"],
      });
    }
  });

export type RenewalDecisionValues = z.infer<typeof renewalDecisionSchema>;

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
  curp?: string | null;
  nss?: string | null;
  ine?: string | null;
  domicilio?: string | null;
  estadoCivil?: string | null;
  nacionalidad?: string | null;
  /** Compensation of the contract being emitted (WRK-I5-2). */
  salarioDiario?: string | null;
  salarioMensual?: string | null;
  formaPago?: string | null;
  periodicidad?: string | null;
  fechaIngreso?: string | null;
  /** seniorityDate() of the person; {{antiguedad}} counts from it (default: fechaIngreso). */
  fechaAntiguedad?: string | null;
  empresa?: string | null;
  empresaRazonSocial?: string | null;
  empresaRfc?: string | null;
};

const pesos = (value: string | null | undefined) =>
  value
    ? Number(value).toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN",
      })
    : null;

/**
 * Each token's value for a context, or null when it has none (the preview
 * reports those as missing). One place for filling and for reporting.
 */
export const templateTokenValues = (
  context: TemplateFillContext,
): Record<ContractTemplateToken, string | null> => {
  const text = (value: string | null | undefined) => value?.trim() || null;

  return {
    nombres: text(context.nombres),
    apellido_paterno: text(context.apellidoPaterno),
    apellido_materno: text(context.apellidoMaterno),
    puesto: text(context.puesto),
    area: text(context.area),
    sucursal: text(context.sucursal),
    rfc: text(context.rfc),
    horario:
      context.horario && context.horario.trim() !== "—"
        ? context.horario.trim()
        : null,
    fecha_inicio: formatContractDate(context.fechaInicio) || null,
    fecha_fin: context.fechaFin
      ? formatContractDate(context.fechaFin) || null
      : null,
    curp: text(context.curp),
    nss: text(context.nss),
    ine: text(context.ine),
    domicilio: text(context.domicilio),
    estado_civil: text(context.estadoCivil),
    nacionalidad: text(context.nacionalidad),
    salario_diario: pesos(context.salarioDiario),
    salario_mensual: pesos(context.salarioMensual),
    // Lowercase: they read mid-sentence («pagadero en forma quincenal»).
    forma_pago: context.formaPago
      ? (
          paymentMethodLabels[
            context.formaPago as (typeof PAYMENT_METHODS)[number]
          ] ?? context.formaPago
        ).toLowerCase()
      : null,
    periodicidad: context.periodicidad
      ? (
          payFrequencyLabels[
            context.periodicidad as (typeof PAY_FREQUENCIES)[number]
          ] ?? context.periodicidad
        ).toLowerCase()
      : null,
    fecha_ingreso: context.fechaIngreso
      ? formatContractDate(context.fechaIngreso) || null
      : null,
    antiguedad: formatSeniority(
      context.fechaAntiguedad === undefined
        ? context.fechaIngreso
        : context.fechaAntiguedad,
      context.fechaInicio,
    ),
    empresa: text(context.empresa),
    empresa_razon_social: text(context.empresaRazonSocial),
    empresa_rfc: text(context.empresaRfc),
  };
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
  const values = templateTokenValues(context);

  return body.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
    if (token in values) {
      const value = values[token as ContractTemplateToken];
      // The schedule prints «—» when there is none, as before; the rest empty.
      return value ?? (token === "horario" ? formatHorarioToken(null) : "");
    }

    return match;
  });
};

/** A tray contract ending within this many days reads «En N días» (warning). */
export const RENEWAL_SOON_DAYS = 30;

export type RenewalUrgency = "vencido" | "proximo" | "en_ventana";

/**
 * Where a contract in the renewal tray stands against `today` (both ISO
 * dates): «Vencido», «Vence hoy», «En 20 días» or «En ventana».
 */
export const renewalStatus = (endDate: string, today: string) => {
  const days = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );

  if (days < 0) {
    return { urgency: "vencido" as const, label: "Vencido", days };
  }

  if (days <= RENEWAL_SOON_DAYS) {
    return {
      urgency: "proximo" as const,
      label:
        days === 0 ? "Vence hoy" : days === 1 ? "En 1 día" : `En ${days} días`,
      days,
    };
  }

  return { urgency: "en_ventana" as const, label: "En ventana", days };
};
