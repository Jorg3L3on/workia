import type { Metadata } from "next";

import { RegionesCatalog } from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { userHasPermission } from "@/lib/rbac";
import { listRegions } from "@/lib/regions";
import { listSites } from "@/lib/sites";
import { requireSitesRead } from "@/lib/sites/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.regiones,
};

type RegionesCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

/** Regions over sites (WRK-I5-4); same permissions as sites. */
const RegionesCatalogPage = async ({
  searchParams,
}: RegionesCatalogPageProps) => {
  const session = await requireSitesRead();
  const { error, saved, deleted } = await searchParams;

  const [regions, sites, canCreate, canUpdate, canDelete] = await Promise.all([
    listRegions(session.companyId),
    listSites(session.companyId),
    userHasPermission(session.user.id, "sites:create"),
    userHasPermission(session.user.id, "sites:update"),
    userHasPermission(session.user.id, "sites:delete"),
  ]);

  return (
    <RegionesCatalog
      canCreate={canCreate}
      canDelete={canDelete}
      canUpdate={canUpdate}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      rows={regions.map((region) => {
        const siteNames = sites
          .filter((site) => site.regionId === region.id)
          .map((site) => site.name);

        return {
          id: region.id,
          name: region.name,
          active: region.active,
          siteNames,
          references: [
            { count: siteNames.length, one: "sucursal", many: "sucursales" },
          ],
        };
      })}
    />
  );
};

export default RegionesCatalogPage;
