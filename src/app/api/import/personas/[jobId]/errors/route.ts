import { NextResponse } from "next/server";

import { buildErrorReport } from "@/lib/import/error-report";
import { getImportJob } from "@/lib/import/jobs";
import { importApiError } from "@/lib/import/route-helpers";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export const GET = async (_request: Request, { params }: Context) => {
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

  const { count, file } = await buildErrorReport(session.companyId, jobId);

  if (count === 0) {
    return NextResponse.json(
      { error: "No hay filas con errores." },
      { status: 404 },
    );
  }

  return new NextResponse(file, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="errores-importacion.xlsx"',
      "Cache-Control": "no-store",
    },
  });
};
