import { z } from "zod";

import { IMPORT_LIMITS, IMPORT_SHEETS } from "./format";

/** Request bodies of the import API, shared by the route handlers and the browser. */

export const createImportJobSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileSizeBytes: z.number().int().min(0).max(IMPORT_LIMITS.maxFileBytes),
  totalRows: z
    .number()
    .int()
    .min(1)
    .max(IMPORT_LIMITS.maxRows * 3),
});

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const appendImportRowsSchema = z.object({
  sheet: z.enum(IMPORT_SHEETS),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2),
        cells: z.record(z.string(), cellSchema),
      }),
    )
    .min(1)
    .max(IMPORT_LIMITS.chunkRows),
});

export type CreateImportJobBody = z.infer<typeof createImportJobSchema>;
export type AppendImportRowsBody = z.infer<typeof appendImportRowsSchema>;

export type CreateImportJobResponse = {
  jobId: string;
  /** Earlier jobs with the same file hash that were not discarded. */
  previous: { id: string; status: string; createdAt: string }[];
};
