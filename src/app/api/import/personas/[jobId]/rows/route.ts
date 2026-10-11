import { NextResponse } from "next/server";

import { appendImportRowsSchema } from "@/lib/import/api-schemas";
import { appendImportRows } from "@/lib/import/jobs";
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

  const parsed = appendImportRowsSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  await appendImportRows(jobId, parsed.data);

  return NextResponse.json({ stored: parsed.data.rows.length });
};
