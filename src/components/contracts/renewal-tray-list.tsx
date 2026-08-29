"use client";

import { useMemo } from "react";

import { NoRenewButton } from "@/components/contracts/no-renew-button";
import { RenewContractForm } from "@/components/contracts/renew-contract-form";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import type { Contract, ContractTemplate } from "@/lib/db/schema";
import {
  contractNoticeWindowLabels,
  formatContractDate,
} from "@/lib/contracts/schema";
import { TableCell, TableRow } from "@/components/ui/table";

export type RenewalTrayItem = {
  contract: Contract;
  personName: string;
  personId: string;
  endDate: string;
  noticeWindow: Contract["noticeWindow"];
};

export type RenewalTrayListProps = {
  items: RenewalTrayItem[];
  canUpdate: boolean;
  templates: ContractTemplate[];
};

type RenewalRow = {
  id: string;
  personName: string;
  personId: string;
  endDate: string;
  noticeWindow: Contract["noticeWindow"];
  noticeLabel: string;
};

export const RenewalTrayList = ({
  items,
  canUpdate,
  templates,
}: RenewalTrayListProps) => {
  const rows = useMemo<RenewalRow[]>(
    () =>
      items.map((item) => ({
        id: item.contract.id,
        personName: item.personName,
        personId: item.personId,
        endDate: item.endDate,
        noticeWindow: item.noticeWindow,
        noticeLabel: contractNoticeWindowLabels[item.noticeWindow],
      })),
    [items],
  );

  const columns = useMemo<DataTableColumn<RenewalRow>[]>(
    () => [
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.personName,
        cell: (row) => <span className="font-medium">{row.personName}</span>,
      },
      {
        id: "endDate",
        header: "Vence",
        accessor: (row) => row.endDate,
        cell: (row) => (
          <span className="text-muted-foreground tabular-nums">
            {formatContractDate(row.endDate)}
          </span>
        ),
      },
      {
        id: "notice",
        header: "Ventana de aviso",
        accessor: (row) => row.noticeLabel,
        cell: (row) => (
          <span className="text-muted-foreground">{row.noticeLabel}</span>
        ),
      },
      {
        id: "actions",
        header: "Acciones",
        accessor: () => "",
        enableSorting: false,
        headerClassName: "text-right",
        cellClassName: "text-right",
        cell: (row) => (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canUpdate ? <NoRenewButton contractId={row.id} /> : null}
            <ListRowAction
              aria-label={`Ver expediente de ${row.personName}`}
              href={`/app/personas/${row.personId}`}
            >
              Ver expediente
            </ListRowAction>
          </div>
        ),
      },
    ],
    [canUpdate],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyDescription="Los contratos aparecen aquí cuando entran en su ventana de aviso configurada."
      emptyTitle="Sin renovaciones pendientes"
      getRowId={(row) => row.id}
      renderAfterRow={
        canUpdate && templates.length > 0
          ? (row) => (
              <TableRow className="hover:bg-transparent">
                <TableCell className="bg-muted/20 py-4" colSpan={4}>
                  <RenewContractForm
                    contractId={row.id}
                    endDate={row.endDate}
                    personName={row.personName}
                    templates={templates}
                  />
                </TableCell>
              </TableRow>
            )
          : undefined
      }
      resultPlural="contratos"
      resultSingular="contrato"
      searchPlaceholder="Buscar persona o fecha"
    />
  );
};
