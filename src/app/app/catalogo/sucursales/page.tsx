import type { Metadata } from "next";

import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";
import { CatalogSitesTable } from "@/components/catalog/catalog-data-tables";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSiteAction } from "@/lib/sites/actions";
import { requireSitesRead } from "@/lib/sites/auth";
import { listSites } from "@/lib/sites";
import { listRegions } from "@/lib/regions";
import { SITE_KINDS, siteKindLabels } from "@/lib/sites/schema";
import { userHasPermission } from "@/lib/rbac";
import { CompanyField } from "@/components/tenant/company-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.sucursales,
};

type SucursalesCatalogPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    deleted?: string;
  }>;
};

const SucursalesCatalogPage = async ({
  searchParams,
}: SucursalesCatalogPageProps) => {
  const session = await requireSitesRead();
  const { error, saved, deleted } = await searchParams;

  const [siteRows, regionRows, canCreateSite, canUpdateSite, canDeleteSite] =
    await Promise.all([
      listSites(session.companyId),
      listRegions(session.companyId),
      userHasPermission(session.user.id, "sites:create"),
      userHasPermission(session.user.id, "sites:update"),
      userHasPermission(session.user.id, "sites:delete"),
    ]);
  const regionName = new Map(regionRows.map((region) => [region.id, region]));
  const activeRegions = regionRows
    .filter((region) => region.active)
    .map((region) => ({ id: region.id, name: region.name }));

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        description="Dónde trabaja la gente: corporativo o sucursal. No es un árbol ni un área."
        descriptionSecondary="Lista de todas las ubicaciones registradas."
        title="Sucursales"
      />

      <CatalogStatusMessages error={error} deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogFormTray
          actions={
            canCreateSite
              ? [
                  {
                    id: "create",
                    actionLabel: "Nueva sucursal",
                    formTitle: "Nueva sucursal",
                    children: (
                      <form action={createSiteAction} className="space-y-3">
                        <CompanyField />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="site-name">Nombre</Label>
                            <Input
                              id="site-name"
                              name="name"
                              placeholder="Ej. Sucursal Demo Norte"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="site-kind">Tipo</Label>
                            <FormSelect
                              defaultValue="sucursal"
                              id="site-kind"
                              name="kind"
                              options={SITE_KINDS.map((kind) => ({
                                value: kind,
                                label: siteKindLabels[kind],
                              }))}
                              required
                              variant="field"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="site-region">Región</Label>
                            <FormSelect
                              defaultValue=""
                              id="site-region"
                              name="regionId"
                              options={[
                                { value: "", label: "Sin región" },
                                ...activeRegions.map((region) => ({
                                  value: region.id,
                                  label: region.name,
                                })),
                              ]}
                              variant="field"
                            />
                          </div>
                        </div>
                        <Button type="submit" variant="outline">
                          Crear sucursal
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []
          }
        />

        <CatalogSitesTable
          canDelete={canDeleteSite}
          canUpdate={canUpdateSite}
          regions={activeRegions}
          sites={siteRows.map((site) => ({
            id: site.id,
            name: site.name,
            kindLabel: siteKindLabels[site.kind],
            regionId: site.regionId,
            regionName: site.regionId
              ? (regionName.get(site.regionId)?.name ?? null)
              : null,
          }))}
        />
      </section>
    </div>
  );
};

export default SucursalesCatalogPage;
