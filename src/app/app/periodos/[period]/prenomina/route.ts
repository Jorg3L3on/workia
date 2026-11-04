import { NextResponse } from "next/server";

import { isQuincena } from "@/lib/pay-periods";
import { exportPrenomina, PrenominaError } from "@/lib/prenomina";
import { requirePrenominaRead } from "@/lib/prenomina/auth";
import { DEFAULT_TEMPLATE_ID } from "@/lib/prenomina/template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The pre-nómina file of a closed quincena (W2-18), with the template in
 * ?plantilla= (the built-in one by default). Needs pay_periods:read and
 * people:export, because the file names people with their CURP, RFC and
 * NSS. An open quincena is 409: HR closes it first. Audited as
 * prenomina_export.
 */
export const GET = async (
  request: Request,
  { params }: { params: Promise<{ period: string }> },
) => {
  let session;

  try {
    session = await requirePrenominaRead();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  if (!session.permissions.has("people:export")) {
    return new NextResponse(null, { status: 403 });
  }

  const { period } = await params;

  if (!isQuincena(period)) {
    return new NextResponse(null, { status: 404 });
  }

  const templateId =
    new URL(request.url).searchParams.get("plantilla") || DEFAULT_TEMPLATE_ID;

  try {
    const file = await exportPrenomina(session.companyId, period, templateId, {
      actorUserId: session.user.id,
      companySlug: session.membership.companySlug,
    });

    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PrenominaError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "not_found" ? 404 : 409 },
      );
    }

    throw error;
  }
};
