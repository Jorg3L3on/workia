import { z } from "zod";

import { IMPORT_LIMITS, IMPORT_SHEETS, MAX_ROWS_PER_FILE } from "./format";

/**
 * Request bodies of the import API, shared by the route handlers and the
 * browser. `fileSizeBytes` and `totalRows` are what the browser declares: they
 * are checked for sanity, but the limits are enforced on the rows the server
 * actually stored (jobs.ts).
 */

export const createImportJobSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileSizeBytes: z.number().int().min(0).max(IMPORT_LIMITS.maxFileBytes),
  totalRows: z.number().int().min(1).max(MAX_ROWS_PER_FILE),
});

/** No template column holds more than a few hundred characters. */
const MAX_CELL_LENGTH = 1000;

const cellSchema = z.union([
  z.string().max(MAX_CELL_LENGTH),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const appendImportRowsSchema = z.object({
  sheet: z.enum(IMPORT_SHEETS),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2).max(IMPORT_LIMITS.maxRowNumber),
        cells: z.record(z.string().max(64), cellSchema),
      }),
    )
    .min(1)
    .max(IMPORT_LIMITS.chunkRows)
    .refine(
      (rows) => new Set(rows.map((row) => row.rowNumber)).size === rows.length,
      "Una fila aparece dos veces en el mismo envío.",
    ),
});

export type CreateImportJobBody = z.infer<typeof createImportJobSchema>;
export type AppendImportRowsBody = z.infer<typeof appendImportRowsSchema>;

export type CreateImportJobResponse = {
  jobId: string;
  /** Earlier jobs with the same file hash that were not discarded. */
  previous: { id: string; status: string; createdAt: string }[];
};
