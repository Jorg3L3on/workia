import type {
  AppendImportRowsBody,
  CreateImportJobResponse,
} from "./api-schemas";
import { chunkRows, type ParsedImportFile } from "./client";
import { IMPORT_LIMITS } from "./format";

export type UploadProgress = {
  sentRows: number;
  totalRows: number;
};

export type UploadResult = CreateImportJobResponse & { total: number };

type UploadOptions = {
  fetchImpl?: typeof fetch;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  chunkSize?: number;
  retries?: number;
  /** Resume an interrupted upload; re-sent chunks replace themselves. */
  jobId?: string;
};

const BASE = "/api/import/personas";

const postJson = async <T>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  retries: number,
): Promise<T> => {
  let lastError: Error = new Error("No se pudo subir el archivo.");

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
      };

      if (response.ok) {
        return payload;
      }

      lastError = new Error(payload.error ?? `Error ${response.status}`);

      // Client errors will not improve on retry.
      if (response.status >= 400 && response.status < 500) {
        throw lastError;
      }
    } catch (error) {
      if (signal?.aborted || (error as Error) === lastError) {
        throw error;
      }

      lastError = error as Error;
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }

  throw lastError;
};

/**
 * Sends a parsed file to the server: create the job, send each sheet in chunks
 * that fit the function body limit, then finalize.
 */
export const uploadParsedFile = async (
  file: ParsedImportFile,
  options: UploadOptions = {},
): Promise<UploadResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  const size = options.chunkSize ?? IMPORT_LIMITS.chunkRows;
  const { signal } = options;
  const totalRows = file.totalRows;

  const created = options.jobId
    ? ({ jobId: options.jobId, previous: [] } as CreateImportJobResponse)
    : await postJson<CreateImportJobResponse>(
        fetchImpl,
        BASE,
        {
          fileName: file.fileName,
          fileHash: file.fileHash,
          fileSizeBytes: file.fileSizeBytes,
          totalRows,
        },
        signal,
        retries,
      );

  let sentRows = 0;

  options.onProgress?.({ sentRows, totalRows });

  for (const sheet of file.sheets) {
    for (const rows of chunkRows(sheet.rows, size)) {
      const body: AppendImportRowsBody = { sheet: sheet.sheet, rows };

      await postJson(
        fetchImpl,
        `${BASE}/${created.jobId}/rows`,
        body,
        signal,
        retries,
      );

      sentRows += rows.length;
      options.onProgress?.({ sentRows, totalRows });
    }
  }

  const finalized = await postJson<{ total: number }>(
    fetchImpl,
    `${BASE}/${created.jobId}/finalize`,
    {},
    signal,
    retries,
  );

  return { ...created, total: finalized.total };
};
