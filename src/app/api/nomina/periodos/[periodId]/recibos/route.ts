import { NextResponse } from "next/server";
import { z } from "zod";

import { importPayrollReceipt, payrollStorageReady } from "@/lib/payroll";
import { requirePayrollManage } from "@/lib/payroll/auth";
import { PAYROLL_COPY } from "@/lib/payroll/schema";
import { AuthorizationError } from "@/lib/rbac/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const periodIdParam = z.string().uuid();

type Context = { params: Promise<{ periodId: string }> };

const bytesOf = async (value: FormDataEntryValue | null) =>
  value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : null;

/**
 * Uploads one receipt (its CFDI XML and PDF) into a period (W2-03). The
 * import dialog unzips the provider's file in the browser and calls this once
 * per receipt, so every request stays small. Needs payroll_receipts:manage; a
 * period of another company is a 404.
 */
export const POST = async (request: Request, { params }: Context) => {
  let session;

  try {
    session = await requirePayrollManage();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AuthorizationError
            ? PAYROLL_COPY.denied
            : "Sesión no válida.",
      },
      { status: error instanceof AuthorizationError ? 403 : 401 },
    );
  }

  const { periodId } = await params;

  if (!periodIdParam.safeParse(periodId).success) {
    return NextResponse.json(
      { error: PAYROLL_COPY.periodNotFound },
      { status: 404 },
    );
  }

  if (!payrollStorageReady()) {
    return NextResponse.json(
      { error: PAYROLL_COPY.storageMissing },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const xml = await bytesOf(form?.get("xml") ?? null);

  if (!xml) {
    return NextResponse.json(
      { error: PAYROLL_COPY.xmlMissing },
      { status: 400 },
    );
  }

  const outcome = await importPayrollReceipt(
    session.companyId,
    periodId,
    { xml, pdf: await bytesOf(form?.get("pdf") ?? null) },
    session.user.id,
  );

  if (!outcome) {
    return NextResponse.json(
      { error: PAYROLL_COPY.periodNotFound },
      { status: 404 },
    );
  }

  return NextResponse.json(outcome, {
    status: outcome.status === "invalid" ? 422 : 200,
  });
};
