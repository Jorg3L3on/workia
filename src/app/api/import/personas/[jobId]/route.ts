import { NextResponse } from "next/server";

import { getImportJob } from "@/lib/import/jobs";
import { importApiError } from "@/lib/import/route-helpers";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export const GET = async (_request: Request, { params }: Context) => {
  try {
    await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;
  const job = await getImportJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: "No encontramos esta importación." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    counts: job.counts,
    options: job.options,
    failureMessage: job.failureMessage,
    createdAt: job.createdAt.toISOString(),
    appliedAt: job.appliedAt?.toISOString() ?? null,
  });
};
