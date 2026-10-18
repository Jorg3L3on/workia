import type { Metadata } from "next";

import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";
import { CatalogRegionsTable } from "@/components/catalog/catalog-regions-table";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { ListPageHeader } from "@/components/list/list-page-header";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { userHasPermission } from "@/lib/rbac";
import { listRegionsWithSiteCounts } from "@/lib/regions";
import { createRegionAction } from "@/lib/regions/actions";
import { requireSitesRead } from "@/lib/sites/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.regiones,
};

type RegionesCatalogPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    deleted?: string;
  }>;
};

/** Regions over sites (WRK-I5-4); same permissions as sites. */
const RegionesCatalogPage = async ({
  searchParams,
}: RegionesCatalogPageProps) => {
  const session = await requireSitesRead();
  const { error, saved, deleted } = await searchParams;

  const [regionRows, canCreate, canUpdate, canDelete] = await Promise.all([
    listRegionsWithSiteCounts(session.companyId),
    userHasPermission(session.user.id, "sites:create"),
    userHasPermission(session.user.id, "sites:update"),
    userHasPermission(session.user.id, "sites:delete"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        description="Agrupan sucursales (p. ej. Norte, Bajío). Cada sucursal pertenece a una región o a ninguna."
        descriptionSecondary="Personas y la bandeja de renovación se pueden filtrar por región."
        title="Regiones"
      />

      <CatalogStatusMessages error={error} deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogFormTray
          actions={
            canCreate
              ? [
                  {
                    id: "create",
                    actionLabel: "Nueva región",
                    formTitle: "Nueva región",
                    children: (
                      <form action={createRegionAction} className="space-y-3">
                        <CompanyField />
                        <div className="space-y-2 sm:max-w-sm">
                          <Label htmlFor="region-name">Nombre</Label>
                          <Input
                            id="region-name"
                            name="name"
                            placeholder="Ej. Región Norte"
                            required
                          />
                        </div>
                        <Button type="submit" variant="outline">
                          Crear región
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []
          }
        />

        <CatalogRegionsTable
          canDelete={canDelete}
          canUpdate={canUpdate}
          regions={regionRows.map((region) => ({
            id: region.id,
            name: region.name,
            active: region.active,
            siteCount: region.siteCount,
          }))}
        />
      </section>
    </div>
  );
};

export default RegionesCatalogPage;
