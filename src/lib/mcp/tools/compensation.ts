import { z } from "zod";

import {
  PAY_FREQUENCIES,
  PAYMENT_METHODS,
  payFrequencyLabels,
  paymentMethodLabels,
} from "@/lib/contracts/schema";

import { McpToolError } from "../errors";
import type { WorkiaToolContext } from "../run-tool";

/**
 * Compensation of a contract (WRK-I1-10): read and captured only by a
 * connection with the pii scope whose user has compensation:read.
 */
export const compensationVisible = (ctx: WorkiaToolContext) =>
  ctx.piiUnmasked && ctx.permissions.has("compensation:read");

export const compensacionInput = z
  .object({
    salario_diario: z
      .number()
      .positive()
      .max(100000)
      .describe("Salario diario en pesos; el mensual se calcula × 30.4."),
    forma_pago: z.enum(PAYMENT_METHODS),
    periodicidad: z.enum(PAY_FREQUENCIES),
    dia_pago: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe("Texto libre, p. ej. «15 y último»."),
  })
  .describe(
    "Compensación que se congela en el contrato. Sólo con el scope pii y el permiso compensation:read. En renew_contract, si no se envía se conserva la del contrato anterior.",
  );

export type CompensacionInput = z.infer<typeof compensacionInput>;

export const assertCanCapture = (
  ctx: WorkiaToolContext,
  compensacion: CompensacionInput | undefined,
) => {
  if (!compensacion) return;

  if (!ctx.piiUnmasked) {
    throw new McpToolError(
      "FORBIDDEN_SCOPE",
      "Para capturar la compensación la conexión necesita el scope pii.",
      { details: { required_scope: "pii" } },
    );
  }

  if (!ctx.permissions.has("compensation:read")) {
    throw new McpToolError(
      "FORBIDDEN_RBAC",
      "Tu rol no puede ver ni capturar la compensación.",
      { details: { required_permission: "compensation:read" } },
    );
  }
};

/** The form values the contract schemas expect. */
export const compensationFormValues = (
  compensacion: CompensacionInput | undefined,
) =>
  compensacion
    ? {
        salarioDiario: compensacion.salario_diario,
        formaPago: compensacion.forma_pago,
        periodicidadPago: compensacion.periodicidad,
        diaPago: compensacion.dia_pago ?? "",
      }
    : {};

const money = (value: number) =>
  `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const compensacionSummary = (compensacion: CompensacionInput) =>
  `Salario diario ${money(compensacion.salario_diario)}, ${paymentMethodLabels[compensacion.forma_pago].toLowerCase()}, ${payFrequencyLabels[compensacion.periodicidad].toLowerCase()}${compensacion.dia_pago ? ` (${compensacion.dia_pago})` : ""}.`;

export const compensacionSchema = z
  .object({
    capturada: z.boolean(),
    salario_diario: z.number().nullable().optional(),
    salario_mensual: z.number().nullable().optional(),
    forma_pago: z.string().nullable().optional(),
    periodicidad: z.string().nullable().optional(),
    dia_pago: z.string().nullable().optional(),
  })
  .describe(
    "Con el scope pii y compensation:read trae los montos; si no, sólo si está capturada.",
  );

type StoredCompensation = {
  salarioDiario: string | null;
  salarioMensual: string | null;
  formaPago: string | null;
  periodicidadPago: string | null;
  diaPago: string | null;
};

export const compensacion = (
  contract: StoredCompensation,
  ctx: WorkiaToolContext,
) => {
  const capturada = contract.salarioDiario !== null;

  if (!compensationVisible(ctx)) return { capturada };

  return {
    capturada,
    salario_diario:
      contract.salarioDiario === null ? null : Number(contract.salarioDiario),
    salario_mensual:
      contract.salarioMensual === null ? null : Number(contract.salarioMensual),
    forma_pago: contract.formaPago,
    periodicidad: contract.periodicidadPago,
    dia_pago: contract.diaPago,
  };
};

/** A line for fetch, or nothing when the connection may not see it. */
export const compensacionLine = (
  contract: StoredCompensation,
  ctx: WorkiaToolContext,
) => {
  if (contract.salarioDiario === null || !compensationVisible(ctx)) return null;

  return `Compensación: ${compensacionSummary({
    salario_diario: Number(contract.salarioDiario),
    forma_pago: contract.formaPago as CompensacionInput["forma_pago"],
    periodicidad:
      contract.periodicidadPago as CompensacionInput["periodicidad"],
    dia_pago: contract.diaPago ?? undefined,
  })} Mensual ${money(Number(contract.salarioMensual))}.`;
};
