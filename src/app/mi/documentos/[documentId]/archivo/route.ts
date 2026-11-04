import { NextResponse } from "next/server";
import { z } from "zod";

import { documentFileUrlForEmployee } from "@/lib/documents/files";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ documentId: string }> };

/**
 * The employee opens a file they uploaded (W2-04): a short-lived signed URL,
 * logged in the personal data access log. Only the session's own documents;
 * any other id is a 404.
 */
export const GET = async (request: Request, { params }: Context) => {
  const context = await requireEmployeeContext();
  const { documentId } = await params;

  if (!z.string().uuid().safeParse(documentId).success) {
    return new NextResponse(null, { status: 404 });
  }

  const url = await documentFileUrlForEmployee(context, documentId);

  if (!url) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(new URL(url, request.url), {
    status: 303,
    headers: { "cache-control": "no-store" },
  });
};
