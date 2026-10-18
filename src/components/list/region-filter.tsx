"use client";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { FormSelect } from "@/components/ui/form-select";

type RegionFilterProps = {
  id: string;
  value: string;
  regions: { id: string; name: string }[];
};

/** Region filter of a server list (WRK-I5-4): sets ?region= in the URL. */
export const RegionFilter = ({ id, value, regions }: RegionFilterProps) => {
  const controls = useServerListControls();

  if (regions.length === 0) {
    return null;
  }

  return (
    <div className="sm:w-56">
      <label className="sr-only" htmlFor={id}>
        Región
      </label>
      <FormSelect
        aria-label="Región"
        id={id}
        onValueChange={(next) => controls.setFilter("region", next || null)}
        options={[
          { value: "", label: "Todas las regiones" },
          ...regions.map((region) => ({
            value: region.id,
            label: region.name,
          })),
        ]}
        value={value}
      />
    </div>
  );
};
