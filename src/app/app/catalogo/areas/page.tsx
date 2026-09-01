import type { Metadata } from "next";

import { AreaTreeView } from "@/components/catalog/area-tree-view";
import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
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
      <ListPageHeader
        description="Árbol de áreas. Un área borrada desaparece de altas nuevas."
        descriptionSecondary="Lista de áreas del catálogo."
        title="Áreas"
      />

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
                          <FormSelect
                            id="area-parent"
                            name="parentAreaId"
                            options={[
                              { value: "", label: "Sin padre" },
                              ...activeAreas.map((area) => ({
                                value: area.id,
                                label: area.name,
                              })),
                            ]}
                            variant="field"
                          />
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
