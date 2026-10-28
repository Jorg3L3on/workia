import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { requireContractsRead } from "@/lib/contracts/auth";
import { getContractById } from "@/lib/contracts";
import { contractScheduleText } from "@/lib/contracts/schema";
import { ContractPdfGlyphError, renderContractPdf } from "@/lib/contracts/pdf";

const contractIdParam = z.string().uuid();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; contractId: string }> };

/**
 * PDF of one contract (WRK-12). Needs contracts:read and compensation:read,
 * because the stored text can include pay. Another company's contract, or a
 * contract that is not this person's, is a 404. Characters the embedded font
 * cannot draw are a 422, not a PDF with holes.
 */
export const GET = async (_request: Request, { params }: Context) => {
  const session = await requireContractsRead().catch(() => null);

  if (!session?.permissions.has("compensation:read")) {
    return new NextResponse(null, { status: 403 });
  }

  const { id: personId, contractId } = await params;

  if (!contractIdParam.safeParse(contractId).success) {
    return new NextResponse(null, { status: 404 });
  }

  const contract = await getContractById(session.companyId, contractId);

  if (!contract || contract.personId !== personId) {
    return new NextResponse(null, { status: 404 });
  }

  let file;

  try {
    file = await renderContractPdf({
      generatedText: contract.generatedText,
      scheduleText: contractScheduleText(contract),
    });
  } catch (error) {
    if (error instanceof ContractPdfGlyphError) {
      return new NextResponse(error.message, {
        status: 422,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    throw error;
  }

  await recordAuditEvent({
    companyId: session.companyId,
    actorUserId: session.user.id,
    resourceType: "contract",
    resourceId: contract.id,
    action: "export",
    payload: {
      summary: "PDF del contrato",
      after: { format: "pdf" },
    },
  });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="contrato-${contract.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
};
