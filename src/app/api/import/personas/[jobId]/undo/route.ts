import { NextResponse } from "next/server";

import { ImportBlockedError } from "@/lib/import/apply";
import { importApiError } from "@/lib/import/route-helpers";
import { previewUndo, undoJobStep } from "@/lib/import/undo";
import { requirePeopleUndoImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ jobId: string }> };

/** Can this import be undone, and if not, which records got in the way. */
export const GET = async (_request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleUndoImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;

  try {
    return NextResponse.json(await previewUndo(session.companyId, jobId));
  } catch (error) {
    if (error instanceof ImportBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    throw error;
  }
};

/** One undo step (≤200 rows in one transaction); the page loops until `done`. */
export const POST = async (_request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleUndoImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;

  try {
    return NextResponse.json(await undoJobStep(session.companyId, jobId));
  } catch (error) {
    if (error instanceof ImportBlockedError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo deshacer la importación. Puedes continuar." },
      { status: 500 },
    );
  }
};
