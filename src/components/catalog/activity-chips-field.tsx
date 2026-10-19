"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ActivityOption = { id: string; name: string };

type ActivityChipsFieldProps = {
  /** Activities that can be added (active ones). */
  options: ActivityOption[];
  /** The puesto's current activities. */
  initial: ActivityOption[];
};

/**
 * A puesto's activities as chips inside its sheet (WRK-I6-5): ✕ removes one,
 * «+ Agregar» adds one. Sends `activityId` per chip and `syncActivities`.
 */
export const ActivityChipsField = ({
  options,
  initial,
}: ActivityChipsFieldProps) => {
  const [selected, setSelected] = useState<ActivityOption[]>(initial);
  const [open, setOpen] = useState(false);
  const available = options.filter(
    (option) => !selected.some((item) => item.id === option.id),
  );

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm leading-none font-medium">Actividades</legend>
      <input name="syncActivities" type="hidden" value="true" />
      <ul aria-label="Actividades del puesto" className="flex flex-wrap gap-2">
        {selected.map((activity) => (
          <li
            className="bg-muted text-foreground inline-flex h-7 items-center gap-1 rounded-md pr-1 pl-2.5 text-sm"
            key={activity.id}
          >
            <input name="activityId" type="hidden" value={activity.id} />
            {activity.name}
            <button
              aria-label={`Quitar ${activity.name}`}
              className="text-muted-foreground hover:bg-background hover:text-foreground inline-flex size-5 items-center justify-center rounded"
              onClick={() =>
                setSelected((current) =>
                  current.filter((item) => item.id !== activity.id),
                )
              }
              type="button"
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
        <li>
          <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>
              <Button
                className="h-7"
                disabled={available.length === 0}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PlusIcon aria-hidden />
                Agregar
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <div
                aria-label="Actividades disponibles"
                className="grid max-h-64 overflow-y-auto"
                role="listbox"
              >
                {available.map((activity) => (
                  <button
                    aria-selected={false}
                    className="hover:bg-muted focus-visible:bg-muted rounded-md px-2 py-1.5 text-left text-sm outline-none"
                    key={activity.id}
                    onClick={() => {
                      setSelected((current) => [...current, activity]);
                      setOpen(false);
                    }}
                    role="option"
                    type="button"
                  >
                    {activity.name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </li>
      </ul>
      {selected.length === 0 ? (
        <p className="text-muted-foreground text-sm">Sin actividades.</p>
      ) : null}
    </fieldset>
  );
};
