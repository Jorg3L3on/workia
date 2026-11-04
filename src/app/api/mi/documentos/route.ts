import { NextResponse } from "next/server";
import { z } from "zod";

import { uploadEmployeeDocument } from "@/lib/documents/files";
import {
  DOCUMENT_FILE_MAX_BYTES,
  DOCUMENT_FILES_COPY,
} from "@/lib/documents/files-schema";
import { getEmployeeContext } from "@/lib/employee-accounts/session";
import { isoToday } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requirementId = z.string().uuid();

const json = (body: { ok: true } | { error: string }, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

/**
 * Upload of a document file from the employee app (W2-04). The person comes
 * from the employee session, never from the form; the form carries only the
 * requirement and the file. A route handler and not a server action, so the
 * body can be a phone photo (up to 4 MB) without raising the action limit.
 */
export const POST = async (request: Request) => {
  const context = await getEmployeeContext();

  if (!context) {
    return json({ error: "Tu sesión terminó. Vuelve a entrar." }, 401);
  }

  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: DOCUMENT_FILES_COPY.uploadFailed }, 403);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);

  if (declared > DOCUMENT_FILE_MAX_BYTES + 64 * 1024) {
    return json({ error: DOCUMENT_FILES_COPY.tooLarge }, 413);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return json({ error: DOCUMENT_FILES_COPY.uploadFailed }, 400);
  }

  const parsedRequirement = requirementId.safeParse(form.get("requirementId"));
  const file = form.get("file");

  if (!parsedRequirement.success) {
    return json({ error: DOCUMENT_FILES_COPY.notRequired }, 400);
  }

  if (!(file instanceof Blob) || file.size === 0) {
    return json({ error: DOCUMENT_FILES_COPY.empty }, 400);
  }

  if (file.size > DOCUMENT_FILE_MAX_BYTES) {
    return json({ error: DOCUMENT_FILES_COPY.tooLarge }, 413);
  }

  const result = await uploadEmployeeDocument(context, {
    requirementId: parsedRequirement.data,
    file: { bytes: new Uint8Array(await file.arrayBuffer()) },
    today: isoToday(),
  });

  return result.ok
    ? json({ ok: true }, 201)
    : json({ error: result.error }, 400);
};
