import type { Metadata } from "next";

import { AreaTreeView } from "@/components/catalog/area-tree-view";
import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAreaAction } from "@/lib/catalog/actions";
import { requireAreasRead } from "@/lib/catalog/auth";
import { listAreas } from "@/lib/catalog";
import { buildAreaTree } from "@/lib/catalog/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.areas,
};

type AreasCatalogPageProps = {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
};

const AreasCatalogPage = async ({ searchParams }: AreasCatalogPageProps) => {
  const session = await requireAreasRead();
  const { saved, deleted } = await searchParams;

  const [areas, canCreateArea, canDeleteArea] = await Promise.all([
    listAreas(),
    userHasPermission(session.user.id, "areas:create"),
    userHasPermission(session.user.id, "areas:delete"),
  ]);

  const areaTree = buildAreaTree(areas);
  const activeAreas = areas.filter((area) => area.active);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Catálogo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Áreas</h1>
        <p className="text-muted-foreground text-sm">
          Árbol de áreas. Un área borrada desaparece de altas nuevas.
        </p>
      </header>

      <CatalogStatusMessages deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogFormTray
          actions={
            canCreateArea
              ? [
                  {
                    id: "create",
                    actionLabel: "Nueva área",
                    formTitle: "Nueva área",
                    children: (
                      <form action={createAreaAction} className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="area-name">Nombre</Label>
                          <Input
                            id="area-name"
                            name="name"
                            placeholder="Ej. Operaciones"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="area-parent">
                            Área padre (opcional)
                          </Label>
                          <select
                            className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                            id="area-parent"
                            name="parentAreaId"
                          >
                            <option value="">Sin padre</option>
                            {activeAreas.map((area) => (
                              <option key={area.id} value={area.id}>
                                {area.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            defaultChecked
                            name="active"
                            type="checkbox"
                            value="true"
                          />
                          Activa
                        </label>
                        <Button type="submit" variant="outline">
                          Crear área
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []
          }
        />

        <AreaTreeView canDelete={canDeleteArea} nodes={areaTree} />
      </section>
    </div>
  );
};

export default AreasCatalogPage;
