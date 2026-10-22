import { z } from "zod";

import type {
  EmploymentPeriodRow,
  EmploymentSummary,
} from "@/lib/people/employment";
import { listTerminationReasons } from "@/lib/termination-reasons";

import { maskText } from "../mask";
import {
  defineTool,
  readAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import { FREE_TEXT_NOTE, mx } from "./common";
import { compensationVisible } from "./compensation";

/**
 * Baja y periodos laborales in the connector (Iniciativa 2). The finiquito
 * amount is payroll data: only with the pii scope and compensation:read,
 * like the salaries (tools/compensation.ts). The comentario is free text and
 * is scanned for identifiers without pii.
 */
const finiquitoSchema = z
  .object({
    estado: z.string().nullable(),
    fecha: z.string().nullable(),
    monto: z
      .number()
      .nullable()
      .describe("Sólo con el scope pii y compensation:read; si no, null."),
    monto_capturado: z.boolean(),
  })
  .describe("Finiquito de la baja: estado, fecha y monto (enmascarado).");

const bajaFields = {
  fecha_baja: z.string().nullable(),
  fecha_baja_mx: z.string().nullable(),
  baja_sin_fecha: z
    .boolean()
    .describe(
      "Baja anterior a Workia sin fecha conocida: pendiente de revisión.",
    ),
  tipo_baja: z.string().nullable(),
  motivo_baja: z.string().nullable(),
  comentario_baja: z.string().nullable(),
  recontratable: z.boolean().nullable(),
  finiquito: finiquitoSchema,
  requiere_revision: z.boolean(),
};

export const employmentPeriodSchema = z.object({
  id: z.string(),
  fecha_ingreso: z.string().nullable(),
  fecha_ingreso_mx: z.string().nullable(),
  reconoce_antiguedad: z.boolean(),
  abierto: z.boolean(),
  ...bajaFields,
});

export const employmentSummarySchema = z
  .object({
    abierto: z.boolean().describe("true mientras la persona está activa."),
    periodos: z.number().int().describe("Cuántos periodos laborales tiene."),
    fecha_ingreso: z.string().nullable(),
    fecha_antiguedad: z
      .string()
      .nullable()
      .describe(
        "Desde cuándo cuenta la antigüedad: el último ingreso, o antes si al reingresar se reconoció la previa.",
      ),
    reconoce_antiguedad: z.boolean(),
    ...bajaFields,
  })
  .nullable()
  .describe(
    "Periodo laboral vigente (o el último, si está de baja). null si aún no tiene periodos.",
  );

const finiquito = (
  period: Pick<
    EmploymentSummary,
    "finiquitoEstado" | "finiquitoFecha" | "finiquitoMonto"
  >,
  ctx: WorkiaToolContext,
) => ({
  estado: period.finiquitoEstado,
  fecha: period.finiquitoFecha,
  monto:
    period.finiquitoMonto !== null && compensationVisible(ctx)
      ? Number(period.finiquitoMonto)
      : null,
  monto_capturado: period.finiquitoMonto !== null,
});

const comentario = (value: string | null, ctx: WorkiaToolContext) =>
  value && !ctx.piiUnmasked ? maskText(value) : value;

const baja = (
  period: Pick<
    EmploymentSummary,
    | "fechaBaja"
    | "bajaSinFecha"
    | "tipoBaja"
    | "motivoBaja"
    | "comentarioBaja"
    | "recontratable"
    | "finiquitoEstado"
    | "finiquitoFecha"
    | "finiquitoMonto"
    | "requiereRevision"
  >,
  ctx: WorkiaToolContext,
) => ({
  fecha_baja: period.fechaBaja,
  fecha_baja_mx: mx(period.fechaBaja),
  baja_sin_fecha: period.bajaSinFecha,
  tipo_baja: period.tipoBaja,
  motivo_baja: period.motivoBaja,
  comentario_baja: comentario(period.comentarioBaja, ctx),
  recontratable: period.recontratable,
  finiquito: finiquito(period, ctx),
  requiere_revision: period.requiereRevision,
});

export const employmentSummary = (
  summary: EmploymentSummary | null | undefined,
  ctx: WorkiaToolContext,
) =>
  summary
    ? {
        abierto: summary.abierto,
        periodos: summary.periodCount,
        fecha_ingreso: summary.fechaIngreso,
        fecha_antiguedad: summary.fechaAntiguedad,
        reconoce_antiguedad: summary.reconoceAntiguedad,
        ...baja(summary, ctx),
      }
    : null;

export const employmentPeriod = (
  period: EmploymentPeriodRow,
  ctx: WorkiaToolContext,
) => ({
  id: period.id,
  fecha_ingreso: period.fechaIngreso,
  fecha_ingreso_mx: mx(period.fechaIngreso),
  reconoce_antiguedad: period.reconoceAntiguedad,
  abierto: period.fechaBaja === null && !period.bajaSinFecha,
  ...baja(period, ctx),
});

export const listTerminationReasonsTool = defineTool({
  name: "list_termination_reasons",
  title: "Listar motivos de baja",
  description: `Motivos de baja del catálogo de la empresa. Usa su id como motivo_id en set_person_status (baja). ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({ include_inactive: z.boolean().default(false) }),
  output: z.object({
    items: z.array(
      z.object({ id: z.string(), name: z.string(), active: z.boolean() }),
    ),
  }),
  annotations: readAnnotations("Listar motivos de baja"),
  handler: async (args, ctx) => {
    const rows = await listTerminationReasons(ctx.companyId, {
      activeOnly: !args.include_inactive,
    });

    return {
      items: rows.map((reason) => ({
        id: reason.id,
        name: reason.name,
        active: reason.active,
      })),
    };
  },
});
