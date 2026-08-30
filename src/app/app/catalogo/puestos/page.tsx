import { CatalogPositionsTable } from "@/components/catalog/catalog-data-tables";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPositionAction } from "@/lib/catalog/actions";
import { requirePositionsRead } from "@/lib/catalog/auth";
import { listAreas, listPositions } from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type PuestosCatalogPageProps = {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
};

const PuestosCatalogPage = async ({
  searchParams,
}: PuestosCatalogPageProps) => {
  const session = await requirePositionsRead();
  const { saved, deleted } = await searchParams;

  const [positions, areas, canCreatePosition, canDeletePosition] =
    await Promise.all([
      listPositions(),
      listAreas(),
      userHasPermission(session.user.id, "positions:create"),
      userHasPermission(session.user.id, "positions:delete"),
    ]);
  const activeAreas = areas.filter((area) => area.active);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Catálogo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Puestos</h1>
        <p className="text-muted-foreground text-sm">
          Puestos opcionalmente ligados a un área.
        </p>
      </header>

      <CatalogStatusMessages deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
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
            <h2 className="text-sm font-semibold">Nuevo puesto</h2>
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
  );
};

export default PuestosCatalogPage;
