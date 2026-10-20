"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateMx } from "@/lib/format/date";
import { toneFor } from "@/lib/ui/status-tone";

export type AltaListRow = {
  id: string;
  personName: string;
  stage: string;
  stageLabel: string;
  /** Checklist items done, of `checklistTotal`. */
  checklistDone: number;
  checklistTotal: number;
  /** ISO date. */
  startedOn: string;
};

const AltaStage = ({ row }: { row: AltaListRow }) => (
  <Badge tone={toneFor("onboarding", row.stage)}>{row.stageLabel}</Badge>
);

/** Onboardings RH → Nóminas (WRK-I5-7): the row opens the alta. */
export const AltasDataTable = ({ altas }: { altas: AltaListRow[] }) => {
  const columns = useMemo<DataTableColumn<AltaListRow>[]>(
    () => [
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.personName,
        variant: "primary",
        truncate: true,
      },
      {
        id: "stage",
        header: "Etapa",
        accessor: (row) => row.stageLabel,
        cell: (row) => <AltaStage row={row} />,
      },
      {
        id: "checklist",
        header: "Checklist",
        accessor: (row) => row.checklistDone,
        variant: "numeric",
        cell: (row) => `${row.checklistDone}/${row.checklistTotal}`,
      },
      {
        id: "started",
        header: "Iniciada",
        accessor: (row) => row.startedOn,
        variant: "muted",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={altas}
      emptyDescription="Inicia un alta para que RH y Nóminas la aprueben."
      emptyTitle="Sin altas todavía"
      getRowAriaLabel={(row) => `Abrir alta de ${row.personName}`}
      getRowHref={(row) => `/app/altas/${row.id}`}
      getRowId={(row) => row.id}
      mobileCard={(row) => ({
        title: row.personName,
        subtitle: `Checklist ${row.checklistDone}/${row.checklistTotal} · iniciada ${formatDateMx(row.startedOn)}`,
        badge: <AltaStage row={row} />,
      })}
      rowTestId="alta-row"
      searchPlaceholder="Buscar persona"
    />
  );
};
