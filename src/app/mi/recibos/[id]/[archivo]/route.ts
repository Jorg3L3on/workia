import { NextResponse } from "next/server";
import { z } from "zod";

import { getEmployeeContext } from "@/lib/employee-accounts/session";
import { openPayrollReceiptFile } from "@/lib/payroll";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({
  id: z.string().uuid(),
  archivo: z.enum(["pdf", "xml"]),
});

type Context = { params: Promise<{ id: string; archivo: string }> };

/**
 * The employee opens their own receipt's PDF or XML (W2-03). The person comes
 * from the session (requireEmployeeContext's lookup), never from the URL; a
 * receipt that is not theirs or not delivered is a 404. The first open sets
 * opened_at; every open writes the personal data access log (W2-09). Then a
 * redirect to a short-lived link, so the file never passes through here.
 */
export const GET = async (request: Request, { params: raw }: Context) => {
  const context = await getEmployeeContext();

  if (!context) {
    return NextResponse.redirect(new URL("/mi/entrar", request.url), 303);
  }

  const parsed = params.safeParse(await raw);

  if (!parsed.success) {
    return new NextResponse(null, { status: 404 });
  }

  const file = await openPayrollReceiptFile(
    context.companyId,
    parsed.data.id,
    parsed.data.archivo,
    { kind: "employee", personId: context.personId },
  );

  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(new URL(file.url, request.url), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
};
