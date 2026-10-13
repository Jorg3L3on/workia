import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { writeExport, type ExportFilters } from "@/lib/import/export";
import { isUuid } from "@/lib/import/person-rows";
import { requirePeopleExport } from "@/lib/people/auth";
import { userHasPermission } from "@/lib/rbac";
import { AuthorizationError } from "@/lib/rbac/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

const parseFilters = (params: URLSearchParams): ExportFilters => {
  const status = params.get("status");
  const area = params.get("area") ?? "";
  const site = params.get("site") ?? "";

  return {
    status: status === "activa" || status === "baja" ? status : undefined,
    deleted: params.get("deleted") === "1",
    areaId: isUuid(area) ? area : undefined,
    siteId: isUuid(site) ? site : undefined,
    query: params.get("q") ?? undefined,
  };
};

export const GET = async (request: Request) => {
  let session;

  try {
    session = await requirePeopleExport();
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof AuthorizationError ? 403 : 401,
    });
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "csv" ? "csv" : "xlsx";
  const filters = parseFilters(params);
  const includeContracts = await userHasPermission(
    session.user.id,
    "contracts:read",
  );
  const stream = new PassThrough();
  const today = new Date().toISOString().slice(0, 10);

  void writeExport(stream, { format, filters, includeContracts })
    .then((count) =>
      recordAuditEvent({
        actorUserId: session.user.id,
        resourceType: "people_export",
        resourceId: randomUUID(),
        action: "export",
        payload: {
          summary: `Exportación de ${count} personas (${format.toUpperCase()})`,
          after: { format, filters, includeContracts, count },
        },
      }),
    )
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="personas-${today}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
};
