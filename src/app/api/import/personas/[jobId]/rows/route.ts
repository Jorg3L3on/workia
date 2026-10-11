import { NextResponse } from "next/server";

import { appendImportRowsSchema } from "@/lib/import/api-schemas";
import {
  appendImportRows,
  getImportJob,
  listImportRows,
} from "@/lib/import/jobs";
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

const ACTIONS = ["create", "update", "unchanged", "error"] as const;

/** Review table: staged rows of a job, filterable by sheet and action. */
export const GET = async (request: Request, { params }: Context) => {
  try {
    await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;

  if (!(await getImportJob(jobId))) {
    return NextResponse.json(
      { error: "No encontramos esta importación." },
      { status: 404 },
    );
  }

  const query = new URL(request.url).searchParams;
  const action = query.get("action");
  const sheet = query.get("sheet");

  return NextResponse.json(
    await listImportRows(jobId, {
      sheet:
        sheet && ["personas", "horarios", "contratos"].includes(sheet)
          ? sheet
          : undefined,
      action: ACTIONS.find((candidate) => candidate === action),
      page: Number(query.get("page")) || 1,
      pageSize: Number(query.get("pageSize")) || 50,
    }),
  );
};
