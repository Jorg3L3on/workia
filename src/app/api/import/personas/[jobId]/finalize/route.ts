import { NextResponse } from "next/server";

import { finalizeImportUpload } from "@/lib/import/jobs";
import { importApiError, loadUploadingJob } from "@/lib/import/route-helpers";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export const POST = async (request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;
  const loaded = await loadUploadingJob(jobId, session.user.id);

  if (loaded.error) {
    return loaded.error;
  }

  const expected = loaded.job.counts.total ?? 0;
  const { job, staged, total } = await finalizeImportUpload(jobId, expected);

  // Fewer rows than announced means a chunk never arrived: retry the upload.
  if (!job || total < expected) {
    return NextResponse.json(
      { error: "Faltan filas por subir.", expected, received: total },
      { status: 409 },
    );
  }

  return NextResponse.json({ jobId, status: job.status, staged, total });
};
