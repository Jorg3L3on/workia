import { NextResponse } from "next/server";

import {
  ImportBlockedError,
  applyJobStep,
  pauseApply,
} from "@/lib/import/apply";
import { getImportJob } from "@/lib/import/jobs";
import { importApiError } from "@/lib/import/route-helpers";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ jobId: string }> };

/** One apply step (≤200 rows in one transaction); the page loops until `done`. */
export const POST = async (_request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;

  if (!(await getImportJob(session.companyId, jobId))) {
    return NextResponse.json(
      { error: "No encontramos esta importación." },
      { status: 404 },
    );
  }

  try {
    return NextResponse.json(await applyJobStep(session.companyId, jobId));
  } catch (error) {
    if (error instanceof ImportBlockedError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo aplicar la importación. Puedes continuarla." },
      { status: 500 },
    );
  }
};

/** Pauses an applying import so another one can run; progress is kept. */
export const DELETE = async (_request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;

  if (!(await getImportJob(session.companyId, jobId))) {
    return NextResponse.json(
      { error: "No encontramos esta importación." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    paused: await pauseApply(session.companyId, jobId),
  });
};
