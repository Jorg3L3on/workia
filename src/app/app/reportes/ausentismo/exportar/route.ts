import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { formatDateTimeMx, isoToday } from "@/lib/format/date";
import {
  getAbsenteeismReport,
  loadAbsenteeismDetail,
} from "@/lib/reports/absenteeism";
import {
  absenteeismSheets,
  describeAbsenteeismFilter,
  writeAbsenteeismExport,
} from "@/lib/reports/absenteeism/export";
import {
  ABSENTEEISM_URL_PARAM,
  parseAbsenteeismParam,
  serializeAbsenteeismFilter,
} from "@/lib/reports/absenteeism/url";
import { requireReportsRead } from "@/lib/reports/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

const FORMATS = ["xlsx", "csv"] as const;

/**
 * Export of the absenteeism and turnover report by región and sucursal
 * (W2-20), from the same URL filter the page reads. The CSV is the table
 * (reports:read); the Excel adds the bajas and each person's faltas, so it
 * names people and needs people:read and people:export too. Audited as
 * report_export.
 */
export const GET = async (request: Request) => {
  let session;

  try {
    session = await requireReportsRead();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const { companyId, permissions } = session;
  const params = new URL(request.url).searchParams;
  const format =
    FORMATS.find((value) => value === params.get("format")) ?? "xlsx";

  if (
    format === "xlsx" &&
    (!permissions.has("people:export") || !permissions.has("people:read"))
  ) {
    return new NextResponse(null, { status: 403 });
  }

  const today = isoToday();
  const filter = parseAbsenteeismParam(
    params.get(ABSENTEEISM_URL_PARAM) ?? undefined,
    today,
  );
  const report = await getAbsenteeismReport(companyId, filter, today);
  const { sites, regions } = report.structure;
  const filterText = describeAbsenteeismFilter(filter, sites, regions);
  const sheets =
    format === "xlsx"
      ? absenteeismSheets(report, {
          companyName: session.membership.companyName,
          filterText,
          generatedAt: formatDateTimeMx(new Date()),
          sites,
          regions,
          detail: await loadAbsenteeismDetail(companyId, filter, sites),
        })
      : null;
  const audit = (rows: number) =>
    recordAuditEvent({
      companyId,
      actorUserId: session.user.id,
      resourceType: "report_export",
      resourceId: randomUUID(),
      action: "export",
      payload: {
        summary: `Reporte de ausentismo y rotación (${format.toUpperCase()}): ${rows} filas del ${filter.from} al ${filter.to}`,
        after: {
          report: "ausentismo",
          format,
          a: serializeAbsenteeismFilter(filter),
          filter: filterText || "Sin filtros",
          count: rows,
        },
      },
    });
  const stream = new PassThrough();

  void writeAbsenteeismExport(stream, format, report, sheets)
    .then(audit)
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="ausentismo-${session.membership.companySlug}-${filter.from}-${filter.to}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
};
