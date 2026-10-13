import { NextResponse } from "next/server";
import { z } from "zod";

import { getImportJob } from "@/lib/import/jobs";
import { importApiError } from "@/lib/import/route-helpers";
import { restartValidation, validateJobStep } from "@/lib/import/validate";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

const optionsSchema = z.object({
  createMissingCatalogs: z.boolean().optional(),
  mode: z.enum(["all_or_nothing", "valid_only"]).optional(),
});

/** One validation step; the page calls it until `done` is true. */
export const POST = async (request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;
  const job = await getImportJob(session.companyId, jobId);

  if (!job) {
    return NextResponse.json(
      { error: "No encontramos esta importación." },
      { status: 404 },
    );
  }

  if (job.status !== "validating") {
    return NextResponse.json(
      { error: "Esta importación no está en validación." },
      { status: 409 },
    );
  }

  return NextResponse.json(await validateJobStep(session.companyId, jobId));
};

/** Changes the review options and validates again from scratch. */
export const PUT = async (request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return importApiError(error);
  }

  const { jobId } = await params;
  const parsed = optionsSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const job = await getImportJob(session.companyId, jobId);

  if (!job || !["in_review", "validating"].includes(job.status)) {
    return NextResponse.json(
      { error: "No se puede cambiar esta importación." },
      { status: 409 },
    );
  }

  await restartValidation(session.companyId, jobId, parsed.data);

  return NextResponse.json({ status: "validating" });
};
