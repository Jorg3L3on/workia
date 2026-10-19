"use client";

import { CalendarCheckIcon, UserRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompensationDefaults } from "@/components/contracts/compensation-fields";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { RenewalDecisionDialog } from "@/components/contracts/renewal-decision-dialog";
import { Badge } from "@/components/ui/badge";
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
  /** Region chip (WRK-I5-4), server-side through ?region=; hidden without regions. */
  regions?: { id: string; name: string }[];
  region?: string;
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
  regions = [],
  region = "",
}: RenewalTrayListProps) => {
  const controls = useServerListControls();
  const [decidingId, setDecidingId] = useState<string | null>(null);

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
        rowMenu={(row) => (
          <RowMenu
            actions={[
              canUpdate && {
                label: "Decidir renovación",
                icon: CalendarCheckIcon,
                onSelect: () => setDecidingId(row.id),
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
        filters={
          regions.length > 0
            ? [
                {
                  id: "region",
                  label: "Región",
                  value: region,
                  onChange: (next) =>
                    controls.setFilter("region", next || null),
                  options: regions.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                },
              ]
            : undefined
        }
        onClearFilters={() => controls.setFilter("region", null)}
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
