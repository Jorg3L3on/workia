import { NextResponse } from "next/server";
import { z } from "zod";

import { openPayrollReceiptFile } from "@/lib/payroll";
import { requirePayrollRead } from "@/lib/payroll/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({
  id: z.string().uuid(),
  archivo: z.enum(["pdf", "xml"]),
});

type Context = { params: Promise<{ id: string; archivo: string }> };

/**
 * HR opens a receipt's PDF or XML (W2-03): needs payroll_receipts:read, writes
 * the personal data access log (W2-09) and redirects to a short-lived link.
 * Another company's receipt is a 404. HR opening it never counts as the
 * employee opening it.
 */
export const GET = async (request: Request, { params: raw }: Context) => {
  const session = await requirePayrollRead().catch(() => null);

  if (!session) {
    return new NextResponse(null, { status: 403 });
  }

  const parsed = params.safeParse(await raw);

  if (!parsed.success) {
    return new NextResponse(null, { status: 404 });
  }

  const file = await openPayrollReceiptFile(
    session.companyId,
    parsed.data.id,
    parsed.data.archivo,
    { kind: "hr_user", userId: session.user.id },
  );

  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(new URL(file.url, request.url), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
};
