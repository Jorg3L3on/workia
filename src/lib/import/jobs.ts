import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  importJobs,
  importRows,
  type ImportJob,
  type ImportJobStatus,
} from "@/lib/db/schema";

import type { AppendImportRowsBody, CreateImportJobBody } from "./api-schemas";

const PREVIOUS_STATUSES: ImportJobStatus[] = [
  "validating",
  "in_review",
  "applying",
  "applied",
];

export const findJobsByHash = async (fileHash: string) =>
  db
    .select({
      id: importJobs.id,
      status: importJobs.status,
      createdAt: importJobs.createdAt,
    })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.fileHash, fileHash),
        inArray(importJobs.status, PREVIOUS_STATUSES),
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(5);

export const createImportJob = async (
  input: CreateImportJobBody,
  actorUserId: string,
) => {
  const [job] = await db
    .insert(importJobs)
    .values({
      type: "people",
      status: "uploading",
      fileName: input.fileName,
      fileHash: input.fileHash,
      fileSizeBytes: input.fileSizeBytes,
      counts: { total: input.totalRows },
      actorUserId,
    })
    .returning();

  return job;
};

export const getImportJob = async (
  jobId: string,
): Promise<ImportJob | null> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);

  return job ?? null;
};

/**
 * Stores one chunk. Re-sending a chunk (a retry after a dropped connection)
 * replaces the same rows instead of duplicating them.
 */
export const appendImportRows = async (
  jobId: string,
  body: AppendImportRowsBody,
) => {
  await db
    .insert(importRows)
    .values(
      body.rows.map((row) => ({
        jobId,
        sheet: body.sheet,
        rowNumber: row.rowNumber,
        raw: row.cells,
      })),
    )
    .onConflictDoUpdate({
      target: [importRows.jobId, importRows.sheet, importRows.rowNumber],
      set: {
        raw: sql`excluded.raw`,
        normalized: null,
        action: "pending",
        errors: null,
      },
    });
};

export const countStagedRows = async (jobId: string) => {
  const rows = await db
    .select({
      sheet: importRows.sheet,
      count: sql<number>`count(*)::int`,
    })
    .from(importRows)
    .where(eq(importRows.jobId, jobId))
    .groupBy(importRows.sheet);

  return Object.fromEntries(rows.map((row) => [row.sheet, row.count]));
};

/**
 * Closes the upload. The job only moves to validation when every announced row
 * is staged, so a chunk that never arrived cannot be validated as a whole file.
 */
export const finalizeImportUpload = async (
  jobId: string,
  expectedRows: number,
) => {
  const staged = await countStagedRows(jobId);
  const total = Object.values(staged).reduce((sum, n) => sum + n, 0);

  if (total < expectedRows) {
    return { job: null, staged, total };
  }

  const [job] = await db
    .update(importJobs)
    .set({ status: "validating", counts: { total } })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "uploading")))
    .returning();

  return { job: job ?? null, staged, total };
};
