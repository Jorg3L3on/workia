import type { PeopleFilterCondition } from "@/lib/people/filter/schema";
import { peopleFilterQueryString } from "@/lib/people/filter/url";

import type { TurnoverDimension, TurnoverFilter } from "./schema";

const FIELD: Record<TurnoverDimension, PeopleFilterCondition["field"]> = {
  area: "area",
  site: "sucursal",
  position: "puesto",
  manager: "jefe",
};

/**
 * The closest Personas filter for a segment of the report: fecha de baja in
 * the range plus the dimension. Personas filters by each person's current
 * period and área, so a rehired person or one who moved does not show there;
 * the drill-down says how many.
 */
export const personasHrefFor = (
  range: Pick<TurnoverFilter, "from" | "to">,
  segment: {
    dimension?: TurnoverDimension;
    /** The group's id; null («Sin …») and «Otros» have no Personas filter. */
    key?: string | null;
    tipos?: TurnoverFilter["tipos"];
    motivoIds?: string[];
  } = {},
) => {
  const conditions: PeopleFilterCondition[] = [
    { field: "baja", op: "between", from: range.from, to: range.to },
  ];

  if (segment.dimension && segment.key) {
    conditions.push({
      field: FIELD[segment.dimension],
      op: "is",
      values: [segment.key],
    });
  }

  if (segment.tipos?.length) {
    conditions.push({ field: "tipoBaja", op: "is", values: segment.tipos });
  }

  if (segment.motivoIds?.length) {
    conditions.push({
      field: "motivoBaja",
      op: "is",
      values: segment.motivoIds,
    });
  }

  return `/app/personas?${peopleFilterQueryString({
    q: "",
    deleted: false,
    conditions,
  })}`;
};
