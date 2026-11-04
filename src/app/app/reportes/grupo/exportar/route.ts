import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { requireAuth } from "@/lib/auth/session";
import { formatDateTimeMx, isoToday } from "@/lib/format/date";
import { getGroupDashboard, loadGroupReportReader } from "@/lib/reports/group";
import { writeGroupExport } from "@/lib/reports/group/export";
import {
  GROUP_URL_PARAM,
  parseGroupParam,
  serializeGroupFilter,
} from "@/lib/reports/group/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

const FORMATS = ["xlsx", "csv"] as const;

/**
 * Export of the group dashboard (W2-25), from the same URL filter the page
 * reads: the table by company, región and sucursal, as CSV or as Excel with
 * the definitions. Counts and rates only, so reports:read in each company is
 * enough. Audited as report_export in every company it includes.
 */
export const GET = async (request: Request) => {
  let userId: string;

  try {
    userId = (await requireAuth()).user.id;
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const reader = await loadGroupReportReader(userId);

  if (reader.companies.length === 0) {
    return new NextResponse(null, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const format =
    FORMATS.find((value) => value === params.get("format")) ?? "xlsx";
  const today = isoToday();
  const filter = parseGroupParam(
    params.get(GROUP_URL_PARAM) ?? undefined,
    today,
  );
  const dashboard = await getGroupDashboard(reader, filter, today);
  const audit = (rows: number) =>
    Promise.all(
      dashboard.companies.map((company) =>
        recordAuditEvent({
          companyId: company.companyId,
          actorUserId: userId,
          resourceType: "report_export",
          resourceId: randomUUID(),
          action: "export",
          payload: {
            summary: `Tablero del grupo (${format.toUpperCase()}): ${dashboard.companies.length} empresas del ${filter.from} al ${filter.to}`,
            after: {
              report: "grupo",
              format,
              g: serializeGroupFilter(filter),
              companies: dashboard.companies.map((row) => row.companyName),
              count: rows,
            },
          },
        }),
      ),
    );
  const stream = new PassThrough();

  void writeGroupExport(stream, format, dashboard, {
    generatedAt: formatDateTimeMx(new Date()),
  })
    .then(audit)
    .catch((error) => stream.destroy(error as Error));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="grupo-${filter.from}-${filter.to}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
};
