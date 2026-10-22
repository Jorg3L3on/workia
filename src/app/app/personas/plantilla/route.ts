import { NextResponse } from "next/server";

import { listActiveContractTemplates } from "@/lib/contracts";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import { buildImportTemplate } from "@/lib/import/template";
import { listActivePeopleForSelect } from "@/lib/people";
import { requirePeopleImport } from "@/lib/people/auth";
import { AuthorizationError } from "@/lib/rbac/errors";
import { listActiveSites } from "@/lib/sites";
import { listTerminationReasons } from "@/lib/termination-reasons";

export const dynamic = "force-dynamic";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = async () => {
  let session;

  try {
    session = await requirePeopleImport();
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof AuthorizationError ? 403 : 401,
    });
  }

  const [areas, positions, sites, templates, activePeople, reasons] =
    await Promise.all([
      listActiveAreas(session.companyId),
      listActivePositions(session.companyId),
      listActiveSites(session.companyId),
      listActiveContractTemplates(session.companyId),
      listActivePeopleForSelect(session.companyId),
      listTerminationReasons(session.companyId, { activeOnly: true }),
    ]);
  // A name shared by two people cannot pick one: those need a CURP or ID.
  const names = activePeople.map((person) =>
    [person.nombres, person.apellidoPaterno, person.apellidoMaterno]
      .filter(Boolean)
      .join(" "),
  );
  const repeated = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );

  const file = await buildImportTemplate({
    areas: areas.map((area) => area.name),
    positions: positions.map((position) => position.name),
    sites: sites.map((site) => site.name),
    templates: templates.map((template) => template.name),
    // Positions without an area fit any area.
    areaPositions: areas.map((area) => ({
      area: area.name,
      positions: positions
        .filter((position) => !position.areaId || position.areaId === area.id)
        .map((position) => position.name),
    })),
    managers: names.filter((name) => !repeated.has(name)),
    terminationReasons: reasons.map((reason) => reason.name),
  });

  return new NextResponse(file, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": 'attachment; filename="plantilla-personas.xlsx"',
      "Cache-Control": "no-store",
    },
  });
};
