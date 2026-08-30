"use client";

import { useMemo, useState } from "react";

import { NoRenewButton } from "@/components/contracts/no-renew-button";
import { RenewContractForm } from "@/components/contracts/renew-contract-form";
import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListRowAction } from "@/components/list/list-row-action";
import { Button } from "@/components/ui/button";
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
  const [expandedContractId, setExpandedContractId] = useState<string | null>(
    null,
  );
  const canRenew = canUpdate && templates.length > 0;

  const handleToggleRenewForm = (contractId: string) => {
    setExpandedContractId((current) =>
      current === contractId ? null : contractId,
    );
  };

  const handleCloseRenewForm = () => {
    setExpandedContractId(null);
  };

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
        cell: (row) => {
          const isFormOpen = expandedContractId === row.id;
          const formId = `renewal-form-${row.id}`;

          return (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canRenew ? (
                <Button
                  aria-controls={isFormOpen ? formId : undefined}
                  aria-expanded={isFormOpen}
                  aria-label={`Renovar contrato de ${row.personName}`}
                  className="h-8 px-3 text-xs font-medium"
                  onClick={() => handleToggleRenewForm(row.id)}
                  size="sm"
                  type="button"
                  variant={isFormOpen ? "secondary" : "outline"}
                >
                  Renovar
                </Button>
              ) : null}
              {canUpdate ? <NoRenewButton contractId={row.id} /> : null}
              <ListRowAction
                aria-label={`Ver expediente de ${row.personName}`}
                href={`/app/personas/${row.personId}`}
              >
                Ver expediente
              </ListRowAction>
            </div>
          );
        },
      },
    ],
    [canRenew, canUpdate, expandedContractId],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyDescription="Los contratos aparecen aquí cuando entran en su ventana de aviso configurada."
      emptyTitle="Sin renovaciones pendientes"
      getRowId={(row) => row.id}
      renderAfterRow={
        canRenew
          ? (row) => {
              if (expandedContractId !== row.id) {
                return null;
              }

              return (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="bg-muted/20 py-4" colSpan={4}>
                    <div className="space-y-3" id={`renewal-form-${row.id}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">Renovar contrato</p>
                        <Button
                          aria-label={`Cerrar formulario de renovación de ${row.personName}`}
                          className="h-8 px-3 text-xs font-medium"
                          onClick={handleCloseRenewForm}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Cerrar
                        </Button>
                      </div>
                      <RenewContractForm
                        contractId={row.id}
                        endDate={row.endDate}
                        personName={row.personName}
                        templates={templates}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            }
          : undefined
      }
      resultPlural="contratos"
      resultSingular="contrato"
      searchPlaceholder="Buscar persona o fecha"
    />
  );
};
