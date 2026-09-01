import type { Metadata } from "next";

import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";
import { CatalogPositionsTable } from "@/components/catalog/catalog-data-tables";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { PositionActivitiesAssign } from "@/components/catalog/position-activities-assign";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPositionAction } from "@/lib/catalog/actions";
import { requirePositionsRead } from "@/lib/catalog/auth";
import {
  listActivitiesByPositionIds,
  listAreas,
  listAssignableActivities,
  listPositions,
} from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.puestos,
};

type PuestosCatalogPageProps = {
  searchParams: Promise<{
    saved?: string;
    deleted?: string;
    assigned?: string;
    unassigned?: string;
  }>;
};

const PuestosCatalogPage = async ({
  searchParams,
}: PuestosCatalogPageProps) => {
  const session = await requirePositionsRead();
  const { saved, deleted, assigned, unassigned } = await searchParams;

  const [
    positions,
    areas,
    assignableActivities,
    canCreatePosition,
    canDeletePosition,
    canAssignActivity,
  ] = await Promise.all([
    listPositions(),
    listAreas(),
    listAssignableActivities(),
    userHasPermission(session.user.id, "positions:create"),
    userHasPermission(session.user.id, "positions:delete"),
    userHasPermission(session.user.id, "positions:update"),
  ]);
  const activitiesByPosition = await listActivitiesByPositionIds(
    positions.map((position) => position.id),
  );
  const activeAreas = areas.filter((area) => area.active);
  const canShowAssign =
    canAssignActivity &&
    positions.length > 0 &&
    assignableActivities.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        description="Puestos opcionalmente ligados a un área, con actividades asignadas."
        descriptionSecondary="Lista de todos los puestos registrados."
        title="Puestos"
      />

      <CatalogStatusMessages
        assigned={assigned}
        deleted={deleted}
        saved={saved}
        unassigned={unassigned}
      />

      <section className="workia-pass-card space-y-4 p-5">
        <CatalogFormTray
          actions={[
            ...(canCreatePosition
              ? [
                  {
                    id: "create",
                    actionLabel: "Nuevo puesto",
                    formTitle: "Nuevo puesto",
                    children: (
                      <form action={createPositionAction} className="space-y-3">
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
                          <FormSelect
                            id="position-area"
                            name="areaId"
                            options={[
                              { value: "", label: "Sin área" },
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
                          Activo
                        </label>
                        <Button type="submit" variant="outline">
                          Crear puesto
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []),
            ...(canShowAssign
              ? [
                  {
                    id: "assign",
                    actionLabel: "Asignar actividad",
                    formTitle: "Asignar actividad",
                    children: (
                      <PositionActivitiesAssign
                        activities={assignableActivities.map((activity) => ({
                          id: activity.id,
                          name: activity.name,
                        }))}
                        positions={positions.map((position) => ({
                          id: position.id,
                          name: position.name,
                          assignedActivityIds: (
                            activitiesByPosition.get(position.id) ?? []
                          ).map((activity) => activity.id),
                        }))}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />

        <CatalogPositionsTable
          canAssign={canAssignActivity}
          canDelete={canDeletePosition}
          positions={positions.map((position) => ({
            id: position.id,
            name: position.name,
            areaName:
              areas.find((area) => area.id === position.areaId)?.name ?? "—",
            active: position.active,
            activities: activitiesByPosition.get(position.id) ?? [],
          }))}
        />
      </section>
    </div>
  );
};

export default PuestosCatalogPage;
