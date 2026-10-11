import { NextResponse } from "next/server";

import { listActiveContractTemplates } from "@/lib/contracts";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import { buildImportTemplate } from "@/lib/import/template";
import { requirePeopleImport } from "@/lib/people/auth";
import { AuthorizationError } from "@/lib/rbac";
import { listActiveSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = async () => {
  try {
    await requirePeopleImport();
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof AuthorizationError ? 403 : 401,
    });
  }

  const [areas, positions, sites, templates] = await Promise.all([
    listActiveAreas(),
    listActivePositions(),
    listActiveSites(),
    listActiveContractTemplates(),
  ]);

  const file = await buildImportTemplate({
    areas: areas.map((area) => area.name),
    positions: positions.map((position) => position.name),
    sites: sites.map((site) => site.name),
    templates: templates.map((template) => template.name),
  });

  return new NextResponse(file, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": 'attachment; filename="plantilla-personas.xlsx"',
      "Cache-Control": "no-store",
    },
  });
};
