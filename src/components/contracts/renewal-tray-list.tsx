"use client";

import { CalendarCheckIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompensationDefaults } from "@/components/contracts/compensation-fields";

import { RenewalDecisionDialog } from "@/components/contracts/renewal-decision-dialog";
import { RenewContractForm } from "@/components/contracts/renew-contract-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  RowInlineAction,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import type { Contract, ContractTemplate } from "@/lib/db/schema";
import {
  contractNoticeWindowLabels,
  formatContractDate,
  renewalStatus,
} from "@/lib/contracts/schema";
import { toneFor } from "@/lib/ui/status-tone";

export type RenewalTrayItem = {
  contract: Pick<Contract, "id">;
  personName: string;
  personId: string;
  endDate: string;
  noticeWindow: Contract["noticeWindow"];
  compensation?: CompensationDefaults;
};

export type RenewalTrayListProps = {
  items: RenewalTrayItem[];
  canUpdate: boolean;
  templates: ContractTemplate[];
  /** ISO date in Mexico, from the server, so the status matches on hydrate. */
  today: string;
  canSeeCompensation?: boolean;
  /** Active positions, for a position change with the renewal (WRK-I5-6). */
  positions?: { id: string; name: string }[];
};

type RenewalRow = {
  id: string;
  personName: string;
  personId: string;
  endDate: string;
  noticeWindow: Contract["noticeWindow"];
  noticeLabel: string;
  status: ReturnType<typeof renewalStatus>;
  compensation?: CompensationDefaults;
};

const RenewalStatusBadge = ({ row }: { row: RenewalRow }) => (
  <Badge tone={toneFor("renewal", row.status.urgency)}>
    {row.status.label}
  </Badge>
);

export const RenewalTrayList = ({
  items,
  canUpdate,
  templates,
  today,
  canSeeCompensation = false,
  positions = [],
}: RenewalTrayListProps) => {
  const [expandedContractId, setExpandedContractId] = useState<string | null>(
    null,
  );
  const [decidingId, setDecidingId] = useState<string | null>(null);
  // The inline «Renovar» panel stays reachable from the menu until F4 drops it.
  const canRenew = canUpdate && templates.length > 0;

  const rows = useMemo<RenewalRow[]>(
    () =>
      items.map((item) => ({
        id: item.contract.id,
        personName: item.personName,
        personId: item.personId,
        endDate: item.endDate,
        noticeWindow: item.noticeWindow,
        noticeLabel: contractNoticeWindowLabels[item.noticeWindow],
        status: renewalStatus(item.endDate, today),
        compensation: item.compensation,
      })),
    [items, today],
  );
  const deciding = rows.find((row) => row.id === decidingId);

  const columns = useMemo<DataTableColumn<RenewalRow>[]>(
    () => [
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.personName,
        variant: "primary",
        truncate: true,
      },
      {
        id: "endDate",
        header: "Vence",
        accessor: (row) => row.endDate,
        variant: "muted",
        cell: (row) => formatContractDate(row.endDate),
      },
      {
        id: "notice",
        header: "Ventana de aviso",
        accessor: (row) => row.noticeLabel,
        variant: "muted",
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => row.status.days,
        cell: (row) => <RenewalStatusBadge row={row} />,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        emptyDescription="Los contratos aparecen aquí cuando entran en su ventana de aviso configurada."
        emptyTitle="Sin renovaciones pendientes"
        getRowAriaLabel={(row) => `Ver expediente de ${row.personName}`}
        getRowHref={(row) => `/app/personas/${row.personId}`}
        getRowId={(row) => row.id}
        getSearchText={(row) =>
          `${formatContractDate(row.endDate)} ${row.status.label}`
        }
        inlineAction={
          canUpdate
            ? (row) => (
                <RowInlineAction
                  icon={CalendarCheckIcon}
                  label={`Decidir renovación de ${row.personName}`}
                  onClick={() => setDecidingId(row.id)}
                />
              )
            : undefined
        }
        mobileCard={(row) => ({
          title: row.personName,
          subtitle: `Vence ${formatContractDate(row.endDate)} · aviso ${row.noticeLabel.toLowerCase()}`,
          badge: <RenewalStatusBadge row={row} />,
        })}
        renderAfterRow={
          canRenew
            ? (row) =>
                expandedContractId === row.id ? (
                  <div className="space-y-3" id={`renewal-form-${row.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Renovar contrato</p>
                      <Button
                        aria-label={`Cerrar formulario de renovación de ${row.personName}`}
                        onClick={() => setExpandedContractId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Cerrar
                      </Button>
                    </div>
                    <RenewContractForm
                      canSeeCompensation={canSeeCompensation}
                      compensation={row.compensation}
                      contractId={row.id}
                      endDate={row.endDate}
                      personName={row.personName}
                      templates={templates}
                    />
                  </div>
                ) : null
            : undefined
        }
        rowMenu={(row) => (
          <RowMenu
            actions={[
              canUpdate && {
                label: "Decidir renovación",
                icon: CalendarCheckIcon,
                onSelect: () => setDecidingId(row.id),
              },
              canRenew && {
                label: "Renovar contrato",
                icon: RefreshCwIcon,
                onSelect: () =>
                  setExpandedContractId((current) =>
                    current === row.id ? null : row.id,
                  ),
              },
              {
                label: "Ver expediente",
                icon: UserRoundIcon,
                href: `/app/personas/${row.personId}`,
              },
            ]}
            label={`Acciones de ${row.personName}`}
          />
        )}
        rowTestId="renewal-row"
        searchPlaceholder="Buscar persona o fecha"
      />
      {deciding ? (
        <RenewalDecisionDialog
          canSeeCompensation={canSeeCompensation}
          compensation={deciding.compensation}
          contractId={deciding.id}
          endDate={deciding.endDate}
          key={deciding.id}
          onOpenChange={(open) => {
            if (!open) setDecidingId(null);
          }}
          open
          personName={deciding.personName}
          positions={positions}
          templates={templates}
        />
      ) : null}
    </>
  );
};
