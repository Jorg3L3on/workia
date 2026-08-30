"use client";

import { useMemo, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
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

  const handlePositionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedPositionId(event.target.value);
  };

  return (
    <form
      action={assignActivityToPositionAction}
      className="space-y-3 border-t pt-4"
    >
      <h2 className="text-sm font-semibold">Asignar actividad</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="assign-position">Puesto a asignar</Label>
          <select
            className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
            id="assign-position"
            name="positionId"
            onChange={handlePositionChange}
            required
            value={selectedPositionId}
          >
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assign-activity">Actividad a asignar</Label>
          <select
            className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
            disabled={availableActivities.length === 0}
            id="assign-activity"
            name="activityId"
            required
          >
            {availableActivities.length === 0 ? (
              <option value="">Sin actividades disponibles</option>
            ) : (
              availableActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))
            )}
          </select>
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
