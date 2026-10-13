import { NextResponse } from "next/server";

import { createImportJobSchema } from "@/lib/import/api-schemas";
import { createImportJob, findJobsByHash } from "@/lib/import/jobs";
import { importApiError } from "@/lib/import/route-helpers";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

export const POST = async (request: Request) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const parsed = createImportJobSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const [previous, job] = await Promise.all([
    findJobsByHash(session.companyId, parsed.data.fileHash),
    createImportJob(session.companyId, parsed.data, session.user.id),
  ]);

  return NextResponse.json({
    jobId: job.id,
    previous: previous.map((item) => ({
      id: item.id,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    })),
  });
};
