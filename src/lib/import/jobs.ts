import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { tdb } from "@/lib/db";
import {
  importJobs,
  importRows,
  users,
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

export const findJobsByHash = async (companyId: string, fileHash: string) =>
  tdb(companyId)
    .select({
      id: importJobs.id,
      status: importJobs.status,
      createdAt: importJobs.createdAt,
    })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.fileHash, fileHash),
        inArray(importJobs.status, PREVIOUS_STATUSES),
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(5);

export const createImportJob = async (
  companyId: string,
  input: CreateImportJobBody,
  actorUserId: string,
) => {
  const [job] = await tdb(companyId)
    .insert(importJobs)
    .values({
      companyId,
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
  companyId: string,
  jobId: string,
): Promise<ImportJob | null> => {
  const [job] = await tdb(companyId)
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);

  return job ?? null;
};

/**
 * Stores one chunk. Re-sending a chunk (a retry after a dropped connection)
 * replaces the same rows instead of duplicating them.
 */
export const appendImportRows = async (
  companyId: string,
  jobId: string,
  body: AppendImportRowsBody,
) => {
  await tdb(companyId)
    .insert(importRows)
    .values(
      body.rows.map((row) => ({
        companyId,
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

export const countStagedRows = async (companyId: string, jobId: string) => {
  const rows = await tdb(companyId)
    .select({
      sheet: importRows.sheet,
      count: sql<number>`count(*)::int`,
    })
    .from(importRows)
    .where(
      and(eq(importRows.companyId, companyId), eq(importRows.jobId, jobId)),
    )
    .groupBy(importRows.sheet);

  return Object.fromEntries(rows.map((row) => [row.sheet, row.count]));
};

/**
 * Closes the upload. The job only moves to validation when every announced row
 * is staged, so a chunk that never arrived cannot be validated as a whole file.
 */
export const finalizeImportUpload = async (
  companyId: string,
  jobId: string,
  expectedRows: number,
) => {
  const staged = await countStagedRows(companyId, jobId);
  const total = Object.values(staged).reduce((sum, n) => sum + n, 0);

  if (total < expectedRows) {
    return { job: null, staged, total };
  }

  const [job] = await tdb(companyId)
    .update(importJobs)
    .set({ status: "validating", counts: { total } })
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.id, jobId),
        eq(importJobs.status, "uploading"),
      ),
    )
    .returning();

  return { job: job ?? null, staged, total };
};

export type ReviewRowFilters = {
  sheet?: string;
  action?: "create" | "update" | "unchanged" | "error";
  page?: number;
  pageSize?: number;
};

/** One page of staged rows for the review table, with counts for the filter. */
export const listImportRows = async (
  companyId: string,
  jobId: string,
  filters: ReviewRowFilters = {},
) => {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  const where = and(
    eq(importRows.companyId, companyId),
    eq(importRows.jobId, jobId),
    filters.sheet ? eq(importRows.sheet, filters.sheet) : undefined,
    filters.action ? eq(importRows.action, filters.action) : undefined,
  );

  const [rows, [totalRow]] = await Promise.all([
    tdb(companyId)
      .select({
        id: importRows.id,
        sheet: importRows.sheet,
        rowNumber: importRows.rowNumber,
        action: importRows.action,
        raw: importRows.raw,
        errors: importRows.errors,
        diff: importRows.diff,
        appliedAt: importRows.appliedAt,
      })
      .from(importRows)
      .where(where)
      .orderBy(
        sql`case ${importRows.sheet} when 'personas' then 0 when 'horarios' then 1 else 2 end`,
        asc(importRows.rowNumber),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    tdb(companyId)
      .select({ count: sql<number>`count(*)::int` })
      .from(importRows)
      .where(where),
  ]);

  return { rows, total: totalRow?.count ?? 0, page, pageSize };
};

export const listImportJobs = async (companyId: string, limit = 50) =>
  tdb(companyId)
    .select({
      job: importJobs,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(importJobs)
    .leftJoin(users, eq(importJobs.actorUserId, users.id))
    .where(eq(importJobs.companyId, companyId))
    .orderBy(desc(importJobs.createdAt))
    .limit(limit);
