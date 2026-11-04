import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import {
  buildPersonDataExport,
  getArcoRequest,
  recordPersonalDataAccess,
} from "@/lib/privacy";
import { requirePrivacyManage } from "@/lib/privacy/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idParam = z.string().uuid();

type Context = { params: Promise<{ id: string }> };

/**
 * The data export of an ARCO access request (W2-09): everything workia holds
 * about the person, as JSON, generated on the spot. Needs privacy:manage. A
 * request of another company, or one that is not an access request, is a
 * 404. Every download is in the access log and in the audit.
 */
export const GET = async (_request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePrivacyManage();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const { id } = await params;

  if (!idParam.safeParse(id).success) {
    return new NextResponse(null, { status: 404 });
  }

  const request = await getArcoRequest(session.companyId, id);

  if (!request || request.kind !== "access") {
    return new NextResponse(null, { status: 404 });
  }

  const data = await buildPersonDataExport(session.companyId, request.personId);

  if (!data) {
    return new NextResponse(null, { status: 404 });
  }

  await withTransaction(async (tx) => {
    await recordPersonalDataAccess(
      session.companyId,
      {
        personId: request.personId,
        resource: "arco_export",
        resourceId: request.id,
        actorKind: "hr_user",
        actorUserId: session.user.id,
      },
      tx,
    );
    await recordAuditEvent(
      {
        companyId: session.companyId,
        actorUserId: session.user.id,
        resourceType: "arco_request",
        resourceId: request.id,
        action: "export",
        payload: {
          after: { format: "json", personId: request.personId },
          summary: `Exportación ARCO de ${request.personName}`,
        },
      },
      tx,
    );
  }, session.companyId);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="arco-${request.id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
};
