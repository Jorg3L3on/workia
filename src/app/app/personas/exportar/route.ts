import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { isoToday } from "@/lib/format/date";
import { writeExport } from "@/lib/import/export";
import { requirePeopleExport } from "@/lib/people/auth";
import { coercePeopleColumns } from "@/lib/people/filter/columns";
import { peopleFilterContext } from "@/lib/people/filter/query";
import { restrictPeopleFilter } from "@/lib/people/filter/schema";
import {
  parsePeopleFilterParams,
  serializeFilterConditions,
} from "@/lib/people/filter/url";
import { AuthorizationError } from "@/lib/rbac/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

/**
 * The Personas export. It reads the list's own URL (q, f, deleted, and the
 * old status/region/area/site), so the file has the rows the list shows.
 * With `cols` (Exportar (N)) it writes those columns; without, the import
 * format. Contract conditions and columns need contracts:read, payroll
 * columns compensation:read: dropped on the server, whatever the URL says.
 */
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
  const filter = restrictPeopleFilter(
    parsePeopleFilterParams(params),
    session.permissions,
  );
  const context = peopleFilterContext(session.permissions, isoToday());
  const columns = params.has("cols")
    ? coercePeopleColumns(params.get("cols"), session.permissions)
    : undefined;
  const includeContracts = session.permissions.has("contracts:read");
  const stream = new PassThrough();
  const today = context.today;

  void writeExport(stream, {
    companyId: session.companyId,
    format,
    filter,
    context,
    includeContracts,
    columns,
  })
    .then((count) =>
      recordAuditEvent({
        companyId: session.companyId,
        actorUserId: session.user.id,
        resourceType: "people_export",
        resourceId: randomUUID(),
        action: "export",
        payload: {
          summary: `Exportación de ${count} personas (${format.toUpperCase()})`,
          after: {
            format,
            filter: {
              q: filter.q,
              deleted: filter.deleted,
              f: serializeFilterConditions(filter),
              conditions: filter.conditions,
            },
            columns: columns ?? "formato de importación",
            includeContracts,
            count,
          },
        },
      }),
    )
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="personas-${session.membership.companySlug}-${today}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
};
