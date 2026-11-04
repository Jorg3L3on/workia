import { NextResponse } from "next/server";

import { env } from "@/env";
import { isValidObjectKey } from "@/lib/storage";
import { readLocalObject, verifyLocalUrl } from "@/lib/storage/local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves a file of the local storage driver (development, tests, e2e) for a
 * URL signed by signedUrl(): no session, the HMAC signature and its expiry
 * are the check, as with a bucket's presigned URL. Off in production.
 */
export const GET = async (
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) => {
  if (env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const key = (await params).key.join("/");
  const headers = isValidObjectKey(key)
    ? verifyLocalUrl(key, new URL(request.url).searchParams)
    : null;

  if (!headers) return new NextResponse(null, { status: 403 });

  const body = await readLocalObject(key);
  if (!body) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": headers.contentType,
      "content-disposition": headers.contentDisposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
