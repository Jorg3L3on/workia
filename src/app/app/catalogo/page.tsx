import { AreaTreeView } from "@/components/catalog/area-tree-view";
import {
  CatalogPositionsTable,
  CatalogSitesTable,
} from "@/components/catalog/catalog-data-tables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAreaAction, createPositionAction } from "@/lib/catalog/actions";
import { requireAreasRead, requirePositionsRead } from "@/lib/catalog/auth";
import { listAreas, listPositions } from "@/lib/catalog";
import { buildAreaTree } from "@/lib/catalog/schema";
import { userHasPermission } from "@/lib/rbac";
import { createSiteAction } from "@/lib/sites/actions";
import { requireSitesRead } from "@/lib/sites/auth";
import { listSites } from "@/lib/sites";
import { SITE_KINDS, siteKindLabels } from "@/lib/sites/schema";

export const dynamic = "force-dynamic";

type CatalogoPageProps = {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
};

const CatalogoPage = async ({ searchParams }: CatalogoPageProps) => {
  const session = await requireAreasRead();
  await requirePositionsRead();
  await requireSitesRead();

  const { saved, deleted } = await searchParams;

  const [
    areas,
    positions,
    siteRows,
    canCreateArea,
    canCreatePosition,
    canDeletePosition,
    canCreateSite,
    canDeleteSite,
  ] = await Promise.all([
    listAreas(),
    listPositions(),
    listSites(),
    userHasPermission(session.user.id, "areas:create"),
    userHasPermission(session.user.id, "positions:create"),
    userHasPermission(session.user.id, "positions:delete"),
    userHasPermission(session.user.id, "sites:create"),
    userHasPermission(session.user.id, "sites:delete"),
  ]);

  const areaTree = buildAreaTree(areas);
  const activeAreas = areas.filter((area) => area.active);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Organización
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Catálogo organizacional
        </h1>
        <p className="text-muted-foreground text-sm">
          Áreas, puestos y ubicaciones (corporativo o sucursal) para el
          expediente.
        </p>
      </header>

      {saved ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Cambios guardados.
        </p>
      ) : null}

      {deleted ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Registro borrado lógicamente.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="workia-pass-card space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Árbol de áreas</h2>
            <p className="text-muted-foreground text-sm">
              Vista anidada. Un área borrada desaparece de altas nuevas.
            </p>
          </div>
          <AreaTreeView nodes={areaTree} />

          {canCreateArea ? (
            <form action={createAreaAction} className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">Nueva área</h3>
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
                <Label htmlFor="area-parent">Área padre (opcional)</Label>
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
          ) : null}
        </section>

        <section className="workia-pass-card space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Puestos</h2>
            <p className="text-muted-foreground text-sm">
              Puestos opcionalmente ligados a un área.
            </p>
          </div>

          <CatalogPositionsTable
            canDelete={canDeletePosition}
            positions={positions.map((position) => ({
              id: position.id,
              name: position.name,
              areaName:
                areas.find((area) => area.id === position.areaId)?.name ?? "—",
              active: position.active,
            }))}
          />

          {canCreatePosition ? (
            <form
              action={createPositionAction}
              className="space-y-3 border-t pt-4"
            >
              <h3 className="text-sm font-semibold">Nuevo puesto</h3>
              <div className="space-y-2">
                <Label htmlFor="position-name">Nombre</Label>
                <Input
                  id="position-name"
                  name="name"
                  placeholder="Ej. Coordinador"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="position-area">Área (opcional)</Label>
                <select
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                  id="position-area"
                  name="areaId"
                >
                  <option value="">Sin área</option>
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
                Activo
              </label>
              <Button type="submit" variant="outline">
                Crear puesto
              </Button>
            </form>
          ) : null}
        </section>
      </div>

      <section className="workia-pass-card space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Ubicaciones</h2>
          <p className="text-muted-foreground text-sm">
            Dónde trabaja la gente: corporativo o sucursal. No es un árbol ni un
            área.
          </p>
        </div>

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
            <h3 className="text-sm font-semibold">Nueva ubicación</h3>
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
              Crear ubicación
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
};

export default CatalogoPage;
