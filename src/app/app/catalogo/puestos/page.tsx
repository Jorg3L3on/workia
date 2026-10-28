import type { Metadata } from "next";

import {
  PuestosCatalog,
  type PositionDocumentRequirement,
} from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  countCatalogReferences,
  listActivitiesByPositionIds,
  listAreas,
  listAssignableActivities,
  listPositions,
} from "@/lib/catalog";
import { requirePositionsRead } from "@/lib/catalog/auth";
import { listDocumentRequirements } from "@/lib/documents";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.puestos,
};

type PuestosCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

const documentsByPosition = (
  requirements: Awaited<ReturnType<typeof listDocumentRequirements>>,
) => {
  const byPosition = new Map<string, PositionDocumentRequirement[]>();

  for (const requirement of requirements) {
    if (!requirement.positionId) continue;

    const list = byPosition.get(requirement.positionId) ?? [];
    list.push({
      id: requirement.id,
      name: requirement.name,
      required: requirement.required,
      validityMonths: requirement.validityMonths,
      sort: requirement.sort,
      active: requirement.active,
    });
    byPosition.set(requirement.positionId, list);
  }

  return byPosition;
};

const PuestosCatalogPage = async ({
  searchParams,
}: PuestosCatalogPageProps) => {
  const session = await requirePositionsRead();
  const { error, saved, deleted } = await searchParams;

  const [
    positions,
    areas,
    assignableActivities,
    references,
    requirements,
    canCreate,
    canUpdate,
    canDelete,
    canManageDocuments,
  ] = await Promise.all([
    listPositions(session.companyId),
    listAreas(session.companyId),
    listAssignableActivities(session.companyId),
    countCatalogReferences(session.companyId),
    listDocumentRequirements(session.companyId),
    userHasPermission(session.user.id, "positions:create"),
    userHasPermission(session.user.id, "positions:update"),
    userHasPermission(session.user.id, "positions:delete"),
    userHasPermission(session.user.id, "documents:manage"),
  ]);
  const documents = documentsByPosition(requirements);
  const activitiesByPosition = await listActivitiesByPositionIds(
    session.companyId,
    positions.map((position) => position.id),
  );
  const areaName = new Map(areas.map((area) => [area.id, area.name]));

  return (
    <PuestosCatalog
      activities={assignableActivities.map((activity) => ({
        id: activity.id,
        name: activity.name,
      }))}
      areas={areas
        .filter((area) => area.active)
        .map((area) => ({ id: area.id, name: area.name }))}
      canCreate={canCreate}
      canDelete={canDelete}
      canManageDocuments={canManageDocuments}
      canUpdate={canUpdate}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      rows={positions.map((position) => ({
        id: position.id,
        name: position.name,
        active: position.active,
        areaId: position.areaId,
        areaName: position.areaId
          ? (areaName.get(position.areaId) ?? null)
          : null,
        activities: (activitiesByPosition.get(position.id) ?? []).map(
          (activity) => ({ id: activity.id, name: activity.name }),
        ),
        documents: documents.get(position.id) ?? [],
        references: [
          {
            count: references.peopleByPosition.get(position.id) ?? 0,
            one: "persona",
            many: "personas",
          },
        ],
      }))}
    />
  );
};

export default PuestosCatalogPage;
