"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { assignActivityToPositionAction } from "@/lib/catalog/actions";

export type AssignableActivityOption = {
  id: string;
  name: string;
};

export type PositionAssignOption = {
  id: string;
  name: string;
  assignedActivityIds: string[];
};

type PositionActivitiesAssignProps = {
  positions: PositionAssignOption[];
  activities: AssignableActivityOption[];
};

export const PositionActivitiesAssign = ({
  positions,
  activities,
}: PositionActivitiesAssignProps) => {
  const [selectedPositionId, setSelectedPositionId] = useState(
    positions[0]?.id ?? "",
  );

  const availableActivities = useMemo(() => {
    const assigned = new Set(
      positions.find((position) => position.id === selectedPositionId)
        ?.assignedActivityIds ?? [],
    );

    return activities.filter((activity) => !assigned.has(activity.id));
  }, [activities, positions, selectedPositionId]);

  if (positions.length === 0 || activities.length === 0) {
    return null;
  }

  const handlePositionChange = (next: string) => {
    setSelectedPositionId(next);
  };

  return (
    <form action={assignActivityToPositionAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="assign-position">Puesto a asignar</Label>
          <FormSelect
            id="assign-position"
            name="positionId"
            onValueChange={handlePositionChange}
            options={positions.map((position) => ({
              value: position.id,
              label: position.name,
            }))}
            required
            value={selectedPositionId}
            variant="field"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assign-activity">Actividad a asignar</Label>
          <FormSelect
            disabled={availableActivities.length === 0}
            id="assign-activity"
            name="activityId"
            options={
              availableActivities.length === 0
                ? [{ value: "", label: "Sin actividades disponibles" }]
                : availableActivities.map((activity) => ({
                    value: activity.id,
                    label: activity.name,
                  }))
            }
            required={availableActivities.length > 0}
            variant="field"
          />
        </div>
      </div>
      <Button
        disabled={availableActivities.length === 0}
        type="submit"
        variant="outline"
      >
        Asignar actividad
      </Button>
    </form>
  );
};
