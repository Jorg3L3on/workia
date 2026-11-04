"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { incidenciaKindLabel } from "@/lib/pay-periods/copy";

export type PeriodPeopleRow = {
  personId: string;
  name: string;
  kinds: Record<string, { count: number; justified: number; minutes: number }>;
};

const hasMinutes = (kind: string) => kind !== "falta";

/** «3 (1 justificada)» or «2 · 25 min». */
const cellText = (
  kind: string,
  value: { count: number; justified: number; minutes: number } | undefined,
) => {
  if (!value) return "—";

  const parts = [String(value.count)];

  if (value.justified > 0) {
    parts.push(
      `(${value.justified} ${value.justified === 1 ? "justificada" : "justificadas"})`,
    );
  }

  if (hasMinutes(kind) && value.minutes > 0) {
    parts.push(`· ${value.minutes} min`);
  }

  return parts.join(" ");
};

/** One row per person with incidencias in the quincena, one column per kind. */
export const PeriodPeopleTable = ({
  rows,
  kinds,
  emptyTitle,
}: {
  rows: PeriodPeopleRow[];
  kinds: string[];
  emptyTitle: string;
}) => {
  const columns = useMemo<DataTableColumn<PeriodPeopleRow>[]>(
    () => [
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: true,
      },
      ...kinds.map((kind): DataTableColumn<PeriodPeopleRow> => ({
        id: kind,
        header: incidenciaKindLabel(kind),
        accessor: (row) => row.kinds[kind]?.count ?? 0,
        variant: "numeric",
        cell: (row) => cellText(kind, row.kinds[kind]),
      })),
    ],
    [kinds],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyTitle={emptyTitle}
      getRowAriaLabel={(row) => `Ver expediente de ${row.name}`}
      getRowHref={(row) => `/app/personas/${row.personId}`}
      getRowId={(row) => row.personId}
      getSearchText={(row) => row.name}
      mobileCard={(row) => ({
        title: row.name,
        subtitle: kinds
          .filter((kind) => row.kinds[kind])
          .map(
            (kind) =>
              `${incidenciaKindLabel(kind)}: ${cellText(kind, row.kinds[kind])}`,
          )
          .join(" · "),
      })}
      rowTestId="pay-period-person-row"
      searchPlaceholder="Buscar persona…"
    />
  );
};
