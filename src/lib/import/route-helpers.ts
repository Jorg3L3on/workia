import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/rbac/errors";

import { getImportJob } from "./jobs";

export const importApiError = (error: unknown) =>
  NextResponse.json(
    {
      error:
        error instanceof AuthorizationError
          ? "No tienes permiso para importar personas."
          : "Sesión no válida.",
    },
    { status: error instanceof AuthorizationError ? 403 : 401 },
  );

/** The job must exist in the active company, belong to the caller and still be uploading. */
export const loadUploadingJob = async (
  companyId: string,
  jobId: string,
  userId: string,
) => {
  const job = await getImportJob(companyId, jobId);

  if (!job || job.actorUserId !== userId) {
    return {
      error: NextResponse.json(
        { error: "No encontramos esta importación." },
        { status: 404 },
      ),
    };
  }

  if (job.status !== "uploading") {
    return {
      error: NextResponse.json(
        { error: "Esta importación ya no acepta filas." },
        { status: 409 },
      ),
    };
  }

  return { job };
};
