import type { Metadata } from "next";

import { SucursalesCatalog } from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { countCatalogReferences } from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";
import { listRegions } from "@/lib/regions";
import { listSites } from "@/lib/sites";
import { requireSitesRead } from "@/lib/sites/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.sucursales,
};

type SucursalesCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

const SucursalesCatalogPage = async ({
  searchParams,
}: SucursalesCatalogPageProps) => {
  const session = await requireSitesRead();
  const { error, saved, deleted } = await searchParams;

  const [sites, regions, references, canCreate, canUpdate, canDelete] =
    await Promise.all([
      listSites(session.companyId),
      listRegions(session.companyId),
      countCatalogReferences(session.companyId),
      userHasPermission(session.user.id, "sites:create"),
      userHasPermission(session.user.id, "sites:update"),
      userHasPermission(session.user.id, "sites:delete"),
    ]);
  const regionName = new Map(regions.map((region) => [region.id, region.name]));

  return (
    <SucursalesCatalog
      canCreate={canCreate}
      canDelete={canDelete}
      canUpdate={canUpdate}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      regions={regions
        .filter((region) => region.active)
        .map((region) => ({ id: region.id, name: region.name }))}
      rows={sites.map((site) => ({
        id: site.id,
        name: site.name,
        active: true,
        kind: site.kind,
        regionId: site.regionId,
        regionName: site.regionId
          ? (regionName.get(site.regionId) ?? null)
          : null,
        references: [
          {
            count: references.peopleBySite.get(site.id) ?? 0,
            one: "persona",
            many: "personas",
          },
        ],
      }))}
    />
  );
};

export default SucursalesCatalogPage;
