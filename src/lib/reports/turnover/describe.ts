import { terminationTypeLabels } from "@/lib/people/employment-schema";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";

import type { TurnoverLabels } from "./labels";
import type { TurnoverFilter } from "./schema";

/** The active filters in words, for exports and audit («Área: Almacén · …»). */
export const describeTurnoverFilter = (
  filter: TurnoverFilter,
  labels: Omit<TurnoverLabels, "reportsOf">,
  reasonNames: Record<string, string>,
) => {
  const names = (ids: string[], from: Record<string, string>) =>
    ids.map((id) => from[id] ?? "(Borrado)").join(", ");
  const parts = [
    filter.areaIds.length > 0 && `Área: ${names(filter.areaIds, labels.areas)}`,
    filter.siteIds.length > 0 &&
      `Sucursal: ${names(filter.siteIds, labels.sites)}`,
    filter.positionIds.length > 0 &&
      `Puesto: ${names(filter.positionIds, labels.positions)}`,
    filter.managerId &&
      `Jefe: ${labels.managers[filter.managerId] ?? "(Borrado)"}${filter.team ? " y su equipo" : ""}`,
    filter.tipos.length > 0 &&
      `Tipo: ${filter.tipos.map((tipo) => terminationTypeLabels[tipo]).join(", ")}`,
    filter.motivoIds.length > 0 &&
      `Motivo: ${names(filter.motivoIds, reasonNames)}`,
    filter.classifications.length > 0 &&
      `Clasificación: ${filter.classifications
        .map((value) => terminationClassificationLabels[value])
        .join(", ")}`,
  ];

  return parts.filter(Boolean).join(" · ");
};
