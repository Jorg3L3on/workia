import type { Metadata } from "next";

import { ActividadesCatalog } from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { countCatalogReferences, listActivities } from "@/lib/catalog";
import { requireActivitiesRead } from "@/lib/catalog/auth";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.actividades,
};

type ActividadesCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

const ActividadesCatalogPage = async ({
  searchParams,
}: ActividadesCatalogPageProps) => {
  const session = await requireActivitiesRead();
  const { error, saved, deleted } = await searchParams;

  const [activities, references, canCreate, canUpdate, canDelete] =
    await Promise.all([
      listActivities(session.companyId),
      countCatalogReferences(session.companyId),
      userHasPermission(session.user.id, "positions:create"),
      userHasPermission(session.user.id, "positions:update"),
      userHasPermission(session.user.id, "positions:delete"),
    ]);

  return (
    <ActividadesCatalog
      canCreate={canCreate}
      canDelete={canDelete}
      canUpdate={canUpdate}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      rows={activities.map((activity) => {
        const positionCount =
          references.positionsByActivity.get(activity.id) ?? 0;

        return {
          id: activity.id,
          name: activity.name,
          active: activity.active,
          positionCount,
          references: [
            { count: positionCount, one: "puesto", many: "puestos" },
          ],
        };
      })}
    />
  );
};

export default ActividadesCatalogPage;
