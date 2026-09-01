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
import { SITE_KINDS, siteKindLabels } from "@/lib/sites/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.sucursales,
};

type SucursalesCatalogPageProps = {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
};

const SucursalesCatalogPage = async ({
  searchParams,
}: SucursalesCatalogPageProps) => {
  const session = await requireSitesRead();
  const { saved, deleted } = await searchParams;

  const [siteRows, canCreateSite, canDeleteSite] = await Promise.all([
    listSites(),
    userHasPermission(session.user.id, "sites:create"),
    userHasPermission(session.user.id, "sites:delete"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        description="Dónde trabaja la gente: corporativo o sucursal. No es un árbol ni un área."
        descriptionSecondary="Lista de todas las ubicaciones registradas."
        title="Sucursales"
      />

      <CatalogStatusMessages deleted={deleted} saved={saved} />

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
          sites={siteRows.map((site) => ({
            id: site.id,
            name: site.name,
            kindLabel: siteKindLabels[site.kind],
          }))}
        />
      </section>
    </div>
  );
};

export default SucursalesCatalogPage;
