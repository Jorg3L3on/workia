import type { Metadata } from "next";

import { CatalogActivitiesTable } from "@/components/catalog/catalog-activities-table";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createActivityAction,
  updateActivityAction,
} from "@/lib/catalog/actions";
import { requireActivitiesRead } from "@/lib/catalog/auth";
import { getActivityById, listActivities } from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.actividades,
};

type ActividadesCatalogPageProps = {
  searchParams: Promise<{ saved?: string; deleted?: string; edit?: string }>;
};

const ActividadesCatalogPage = async ({
  searchParams,
}: ActividadesCatalogPageProps) => {
  const session = await requireActivitiesRead();
  const { saved, deleted, edit } = await searchParams;

  const [
    activityRows,
    canCreateActivity,
    canUpdateActivity,
    canDeleteActivity,
  ] = await Promise.all([
    listActivities(),
    userHasPermission(session.user.id, "positions:create"),
    userHasPermission(session.user.id, "positions:update"),
    userHasPermission(session.user.id, "positions:delete"),
  ]);

  const editingActivity =
    edit && canUpdateActivity ? await getActivityById(edit) : null;
  const isEditing = Boolean(editingActivity && !editingActivity.deletedAt);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Catálogo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Actividades</h1>
        <p className="text-muted-foreground text-sm">
          Catálogo de actividades que se asignan a puestos. No es texto suelto.
        </p>
      </header>

      <CatalogStatusMessages deleted={deleted} saved={saved} />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogActivitiesTable
          activities={activityRows.map((activity) => ({
            id: activity.id,
            name: activity.name,
            active: activity.active,
          }))}
          canDelete={canDeleteActivity}
          canUpdate={canUpdateActivity}
        />

        {isEditing && editingActivity ? (
          <form
            action={updateActivityAction.bind(null, editingActivity.id)}
            className="space-y-3 border-t pt-4"
          >
            <h2 className="text-sm font-semibold">Editar actividad</h2>
            <div className="space-y-2">
              <Label htmlFor="activity-name">Nombre</Label>
              <Input
                defaultValue={editingActivity.name}
                id="activity-name"
                name="name"
                placeholder="Ej. Atención a solicitudes internas"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                defaultChecked={editingActivity.active}
                name="active"
                type="checkbox"
                value="true"
              />
              Activa
            </label>
            <Button type="submit" variant="outline">
              Guardar cambios
            </Button>
          </form>
        ) : null}

        {!isEditing && canCreateActivity ? (
          <form
            action={createActivityAction}
            className="space-y-3 border-t pt-4"
          >
            <h2 className="text-sm font-semibold">Nueva actividad</h2>
            <div className="space-y-2">
              <Label htmlFor="activity-name">Nombre</Label>
              <Input
                id="activity-name"
                name="name"
                placeholder="Ej. Atención a solicitudes internas"
                required
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
              Crear actividad
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
};

export default ActividadesCatalogPage;
