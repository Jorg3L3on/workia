import type { Metadata } from "next";

import { CatalogSitesTable } from "@/components/catalog/catalog-data-tables";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { Button } from "@/components/ui/button";
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
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Catálogo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Sucursales</h1>
        <p className="text-muted-foreground text-sm">
          Dónde trabaja la gente: corporativo o sucursal. No es un árbol ni un
          área.
        </p>
      </header>

      <CatalogStatusMessages deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogSitesTable
          canDelete={canDeleteSite}
          sites={siteRows.map((site) => ({
            id: site.id,
            name: site.name,
            kindLabel: siteKindLabels[site.kind],
          }))}
        />

        {canCreateSite ? (
          <form action={createSiteAction} className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-semibold">Nueva sucursal</h2>
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
                <select
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                  defaultValue="sucursal"
                  id="site-kind"
                  name="kind"
                  required
                >
                  {SITE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {siteKindLabels[kind]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" variant="outline">
              Crear sucursal
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
};

export default SucursalesCatalogPage;
