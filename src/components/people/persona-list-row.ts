import type { PeopleColumnId } from "@/lib/people/filter/columns";

export type PersonaListRow = {
  id: string;
  name: string;
  status: "activa" | "baja";
  deleted: boolean;
  /** The visible columns' raw values (ISO dates, plain amounts). */
  cells: Partial<Record<PeopleColumnId, string | null>>;
};
