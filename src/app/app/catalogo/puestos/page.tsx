import type { Metadata } from "next";

import { PuestosCatalog } from "@/components/catalog/catalog-entities";
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
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.puestos,
};

type PuestosCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
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
    canCreate,
    canUpdate,
    canDelete,
  ] = await Promise.all([
    listPositions(session.companyId),
    listAreas(session.companyId),
    listAssignableActivities(session.companyId),
    countCatalogReferences(session.companyId),
    userHasPermission(session.user.id, "positions:create"),
    userHasPermission(session.user.id, "positions:update"),
    userHasPermission(session.user.id, "positions:delete"),
  ]);
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
