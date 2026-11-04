import { NextResponse } from "next/server";

import { ContractPdfGlyphError } from "@/lib/contracts/pdf";
import { downloadEmployeeSeniorityLetter } from "@/lib/employee/constancias";
import { getEmployeeContext } from "@/lib/employee-accounts/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The signed-in employee's seniority letter (constancia de antigüedad) as a
 * PDF, dated today (W2-11). The route takes no id: the person comes from the
 * employee session. Each download is logged (access log and audit).
 */
export const GET = async () => {
  const context = await getEmployeeContext();

  if (!context) {
    return new NextResponse(null, { status: 401 });
  }

  let download;

  try {
    download = await downloadEmployeeSeniorityLetter(context);
  } catch (error) {
    if (error instanceof ContractPdfGlyphError) {
      return new NextResponse(
        "Tu constancia tiene caracteres que no se pueden imprimir. Pide a RH una copia.",
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
