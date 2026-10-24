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
import { renderTurnoverPdf } from "@/lib/reports/turnover/pdf";
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
  pdf: "application/pdf",
} as const;

const FORMATS = ["xlsx", "csv", "pdf"] as const;

/**
 * Export of the turnover report (WRK-I12): Excel with every sheet, the
 * bajas as CSV or the dashboard as PDF (generated here with
 * @react-pdf/renderer), from the same URL filter the dashboard reads. Needs
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
  const format =
    FORMATS.find((value) => value === params.get("format")) ?? "xlsx";
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
  const generatedAt = formatDateTimeMx(new Date());
  const audit = (count: number) =>
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
    });
  const headers = {
    "Content-Type": CONTENT_TYPES[format],
    "Content-Disposition": `attachment; filename="rotacion-${session.membership.companySlug}-${filter.from}-${filter.to}.${format}"`,
    "Cache-Control": "no-store",
  };

  if (format === "pdf") {
    const finiquitoPaid = finiquitos
      ? finiquitos
          .filter(
            (item) =>
              item.estado === "pagado" &&
              item.fecha !== null &&
              item.fecha >= filter.from &&
              item.fecha <= filter.to,
          )
          .reduce((sum, item) => sum + (item.monto ?? 0), 0)
      : null;
    const file = await renderTurnoverPdf(report, {
      companyName: session.membership.companyName,
      filterText,
      generatedAt,
      generatedBy: session.user.name ?? session.user.email ?? "Workia",
      finiquitoPaid,
    });

    await audit(report.summary.exits);

    return new NextResponse(new Uint8Array(file), { headers });
  }

  const sheets = turnoverSheets(report, labels, {
    companyName: session.membership.companyName,
    filterText,
    generatedAt,
    finiquitos,
  });
  const stream = new PassThrough();

  void writeTurnoverExport(stream, format, sheets)
    .then(audit)
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers,
  });
};
