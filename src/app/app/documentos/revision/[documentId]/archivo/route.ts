import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDocumentsRead } from "@/lib/documents/auth";
import { documentFileUrlForHr } from "@/lib/documents/files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ documentId: string }> };

/**
 * HR opens an uploaded document file (W2-04). Needs documents:read. Another
 * company's id, or a delivery without a file, is a 404. Each open writes the
 * personal data access log, then redirects to a five-minute signed URL.
 */
export const GET = async (request: Request, { params }: Context) => {
  const session = await requireDocumentsRead().catch(() => null);

  if (!session) {
    return new NextResponse(null, { status: 403 });
  }

  const { documentId } = await params;

  if (!z.string().uuid().safeParse(documentId).success) {
    return new NextResponse(null, { status: 404 });
  }

  const url = await documentFileUrlForHr(
    session.companyId,
    documentId,
    session.user.id,
  );

  if (!url) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(new URL(url, request.url), {
    status: 303,
    headers: { "cache-control": "no-store" },
  });
};
