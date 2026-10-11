import type { ImportJobCounts, ImportJobOptions } from "@/lib/db/schema";

/** Browser-side helpers for the import API (validate, apply, undo, review rows). */

export type JobSummary = {
  id: string;
  status:
    | "uploading"
    | "validating"
    | "in_review"
    | "applying"
    | "applied"
    | "failed"
    | "undone";
  fileName: string;
  counts: ImportJobCounts;
  options: ImportJobOptions;
  failureMessage: string | null;
  createdAt: string;
  appliedAt: string | null;
};

export type ReviewRow = {
  id: string;
  sheet: "personas" | "horarios" | "contratos";
  rowNumber: number;
  action: "pending" | "create" | "update" | "unchanged" | "error";
  raw: Record<string, string | number | boolean | null>;
  errors:
    | { field?: string; message: string; severity?: "error" | "warning" }[]
    | null;
  diff: Record<string, [unknown, unknown]> | null;
  appliedAt: string | null;
};

export type ReviewPage = {
  rows: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/import/personas";

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new ApiError(
      payload.error ?? `Error ${response.status}`,
      response.status,
      payload.code,
    );
  }

  return payload;
};

export const getJob = (jobId: string) =>
  request<JobSummary>(`${BASE}/${jobId}`);

export const getRows = (
  jobId: string,
  filters: { sheet?: string; action?: string; page?: number },
) => {
  const query = new URLSearchParams();

  if (filters.sheet) query.set("sheet", filters.sheet);
  if (filters.action) query.set("action", filters.action);
  if (filters.page) query.set("page", String(filters.page));

  return request<ReviewPage>(`${BASE}/${jobId}/rows?${query}`);
};

/** Calls a step endpoint until it reports `done`, reporting progress each time. */
const loop = async <T extends { done: boolean }>(
  url: string,
  onStep: (step: T) => void,
  signal?: AbortSignal,
) => {
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("Cancelado", "AbortError");
    }

    const step = await request<T>(url, { method: "POST", signal });

    onStep(step);

    if (step.done) {
      return step;
    }
  }
};

export type ValidateStep = { done: boolean; remaining: number };
export type ApplyStep = {
  phase: string;
  done: boolean;
  applied: number;
  remaining: number;
};
export type UndoStep = { done: boolean; remaining: number; undone: number };

export const runValidation = (
  jobId: string,
  onStep: (step: ValidateStep) => void,
  signal?: AbortSignal,
) => loop<ValidateStep>(`${BASE}/${jobId}/validate`, onStep, signal);

export const runApply = (
  jobId: string,
  onStep: (step: ApplyStep) => void,
  signal?: AbortSignal,
) => loop<ApplyStep>(`${BASE}/${jobId}/apply`, onStep, signal);

export const runUndo = (
  jobId: string,
  onStep: (step: UndoStep) => void,
  signal?: AbortSignal,
) => loop<UndoStep>(`${BASE}/${jobId}/undo`, onStep, signal);

export const pauseApply = (jobId: string) =>
  request<{ paused: boolean }>(`${BASE}/${jobId}/apply`, { method: "DELETE" });

/** Changes review options; the job goes back to validating. */
export const updateOptions = (jobId: string, options: ImportJobOptions) =>
  request<{ status: string }>(`${BASE}/${jobId}/validate`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

export type UndoPreview = {
  allowed: boolean;
  reason: string | null;
  windowEndsAt: string | null;
  blockers: { type: string; id: string; name: string; reason: string }[];
  blockerTotal: number;
  rows: number;
};

export const getUndoPreview = (jobId: string) =>
  request<UndoPreview>(`${BASE}/${jobId}/undo`);
