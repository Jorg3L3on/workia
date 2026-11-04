import { z } from "zod";

import { daysBetween } from "../turnover/dates";

/**
 * MAX_AGGREGATE_DAYS of src/lib/timeline/aggregates, the longest range the
 * attendance aggregates read; kept here so the filter has no database import
 * (absenteeism.db.test.ts checks they match).
 */
export const MAX_ABSENTEEISM_RANGE_DAYS = 400;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida");

/**
 * What the absenteeism and turnover report by region and sucursal looks at
 * (Workia 2.0 W2-20). `from`/`to` are inclusive local days, at most
 * MAX_ABSENTEEISM_RANGE_DAYS apart (the attendance aggregates read at most that).
 * Región and sucursal narrow the sucursales shown and the totals; with either
 * one, people without a sucursal are left out.
 */
export const absenteeismFilterSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    regionIds: z.array(z.uuid()).default([]),
    siteIds: z.array(z.uuid()).default([]),
  })
  .refine((filter) => filter.from <= filter.to, {
    message: "La fecha inicial debe ser anterior a la final.",
    path: ["to"],
  })
  .refine(
    (filter) =>
      daysBetween(filter.from, filter.to) + 1 <= MAX_ABSENTEEISM_RANGE_DAYS,
    {
      message: `El rango puede ser de hasta ${MAX_ABSENTEEISM_RANGE_DAYS} días.`,
      path: ["from"],
    },
  );

export type AbsenteeismFilter = z.infer<typeof absenteeismFilterSchema>;
export type AbsenteeismFilterInput = z.input<typeof absenteeismFilterSchema>;
