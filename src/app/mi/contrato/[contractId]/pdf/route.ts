import { NextResponse } from "next/server";
import { z } from "zod";

import { ContractPdfGlyphError } from "@/lib/contracts/pdf";
import { downloadEmployeeContract } from "@/lib/employee/constancias";
import { getEmployeeContext } from "@/lib/employee-accounts/session";

const contractIdParam = z.string().uuid();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ contractId: string }> };

/**
 * The signed-in employee's contract as a PDF (W2-11). The person comes from
 * the employee session; a contract of anyone else is a 404. Each download is
 * logged (access log and audit).
 */
export const GET = async (_request: Request, { params }: Context) => {
  const context = await getEmployeeContext();

  if (!context) {
    return new NextResponse(null, { status: 401 });
  }

  const { contractId } = await params;

  if (!contractIdParam.safeParse(contractId).success) {
    return new NextResponse(null, { status: 404 });
  }

  let download;

  try {
    download = await downloadEmployeeContract(context, contractId);
  } catch (error) {
    if (error instanceof ContractPdfGlyphError) {
      return new NextResponse(
        "Tu contrato tiene caracteres que no se pueden imprimir. Pide a RH una copia.",
        {
          status: 422,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    throw error;
  }

  if (!download) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(download.file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${download.filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
