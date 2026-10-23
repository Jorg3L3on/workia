import { z } from "zod";

import type { TerminationClassification } from "@/lib/db/schema/employment";
import { TERMINATION_CLASSIFICATIONS } from "@/lib/termination-reasons/schema";

import { daysBetween } from "./dates";

const TERMINATION_TYPES = [
  "voluntaria",
  "despido",
  "termino_contrato",
  "otra",
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida");

/** The longest range the report computes: five years of months. */
export const MAX_TURNOVER_RANGE_DAYS = 5 * 366;

/**
 * What the turnover report looks at (WRK-I12). `from`/`to` are inclusive.
 * Área, sucursal, puesto and jefe narrow the population (bajas and
 * plantilla); tipo, motivo and clasificación narrow only the bajas, so
 * «rotación voluntaria» keeps the whole plantilla as its denominator.
 */
export const turnoverFilterSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    areaIds: z.array(z.uuid()).default([]),
    siteIds: z.array(z.uuid()).default([]),
    positionIds: z.array(z.uuid()).default([]),
    /** Jefe: direct reports, or the whole team below with `team`. */
    managerId: z.uuid().nullable().default(null),
    team: z.boolean().default(false),
    tipos: z.array(z.enum(TERMINATION_TYPES)).default([]),
    motivoIds: z.array(z.uuid()).default([]),
    classifications: z.array(z.enum(TERMINATION_CLASSIFICATIONS)).default([]),
  })
  .refine((filter) => filter.from <= filter.to, {
    message: "La fecha inicial debe ser anterior a la final.",
    path: ["to"],
  })
  .refine(
    (filter) => daysBetween(filter.from, filter.to) <= MAX_TURNOVER_RANGE_DAYS,
    { message: "El rango puede ser de hasta 5 años.", path: ["from"] },
  );

export type TurnoverFilter = z.infer<typeof turnoverFilterSchema>;
export type TurnoverFilterInput = z.input<typeof turnoverFilterSchema>;

export type TurnoverDimension = "area" | "site" | "position" | "manager";

export const TURNOVER_DIMENSIONS = [
  "area",
  "site",
  "position",
  "manager",
] as const satisfies readonly TurnoverDimension[];

export const turnoverDimensionLabels: Record<TurnoverDimension, string> = {
  area: "Área",
  site: "Sucursal",
  position: "Puesto",
  manager: "Jefe directo",
};

/**
 * One employment period as the report reads it. The dimensions are the ones
 * the period froze when it closed, or the person's current ones while open.
 */
export type TurnoverFact = {
  id: string;
  personId: string;
  personName: string;
  fechaIngreso: string | null;
  fechaBaja: string | null;
  bajaSinFecha: boolean;
  fechaBajaInferida: boolean;
  requiereRevision: boolean;
  tipoBaja: (typeof TERMINATION_TYPES)[number] | null;
  motivoId: string | null;
  motivoName: string | null;
  /** The motivo's classification now; null when it has none. */
  motivoClassification: TerminationClassification | null;
  recontratable: boolean | null;
  areaId: string | null;
  siteId: string | null;
  positionId: string | null;
  managerId: string | null;
  /** The person's first period (a rehire is any later one). */
  firstOfPerson: boolean;
  /** recontratable of the person's period before this one. */
  previousRecontratable: boolean | null;
};
