import { z } from "zod";

import { daysBetween } from "../turnover/dates";
import { MAX_ABSENTEEISM_RANGE_DAYS } from "../absenteeism/schema";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida");

/**
 * What the group dashboard looks at (Workia 2.0 W2-25): a range of inclusive
 * local days, at most the absenteeism report's 400, and the subsidiaries to
 * show (none means every one the reader may see). Región and sucursal are
 * company catalogs, so they are filtered in each company's own report.
 */
export const groupFilterSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    companyIds: z.array(z.uuid()).default([]),
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

export type GroupFilter = z.infer<typeof groupFilterSchema>;
