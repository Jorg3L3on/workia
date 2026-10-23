import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { formatDateTimeMx, isoToday } from "@/lib/format/date";
import { requireReportsRead } from "@/lib/reports/auth";
import { getTurnoverReport } from "@/lib/reports/turnover";
import { describeTurnoverFilter } from "@/lib/reports/turnover/describe";
import { loadTurnoverFiniquitos } from "@/lib/reports/turnover/data";
import {
  turnoverSheets,
  writeTurnoverExport,
} from "@/lib/reports/turnover/export";
import {
  parseTurnoverParam,
  serializeTurnoverFilter,
  TURNOVER_URL_PARAM,
} from "@/lib/reports/turnover/url";
import { listTerminationReasons } from "@/lib/termination-reasons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

/**
 * Export of the turnover report (WRK-I12): Excel with every sheet or the
 * bajas as CSV, from the same URL filter the dashboard reads. Needs
 * reports:read and people:export (the file names people); the finiquito
 * columns only with compensation:read. Audited as report_export.
 */
export const GET = async (request: Request) => {
  let session;

  try {
    session = await requireReportsRead();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const { companyId, permissions } = session;

  if (!permissions.has("people:export") || !permissions.has("people:read")) {
    return new NextResponse(null, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "csv" ? "csv" : "xlsx";
  const today = isoToday();
  const filter = parseTurnoverParam(
    params.get(TURNOVER_URL_PARAM) ?? undefined,
    today,
  );
  const withFiniquito = permissions.has("compensation:read");
  const [{ report, labels }, reasons, finiquitos] = await Promise.all([
    getTurnoverReport(companyId, filter, { withDetail: true, today }),
    listTerminationReasons(companyId),
    withFiniquito ? loadTurnoverFiniquitos(companyId) : null,
  ]);
  const filterText = describeTurnoverFilter(
    filter,
    labels,
    Object.fromEntries(reasons.map((reason) => [reason.id, reason.name])),
  );
  const sheets = turnoverSheets(report, labels, {
    companyName: session.membership.companyName,
    filterText,
    generatedAt: formatDateTimeMx(new Date()),
    finiquitos,
  });
  const stream = new PassThrough();

  void writeTurnoverExport(stream, format, sheets)
    .then((count) =>
      recordAuditEvent({
        companyId,
        actorUserId: session.user.id,
        resourceType: "report_export",
        resourceId: randomUUID(),
        action: "export",
        payload: {
          summary: `Reporte de rotación (${format.toUpperCase()}): ${count} bajas del ${filter.from} al ${filter.to}`,
          after: {
            report: "rotacion",
            format,
            r: serializeTurnoverFilter(filter),
            filter: filterText || "Sin filtros",
            includeFiniquito: withFiniquito,
            count,
          },
        },
      }),
    )
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="rotacion-${session.membership.companySlug}-${filter.from}-${filter.to}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
};
