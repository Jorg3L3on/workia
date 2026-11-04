"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import { PAY_PERIOD_COPY } from "@/lib/pay-periods/copy";
import { toneFor } from "@/lib/ui/status-tone";

export type PayPeriodTableRow = {
  period: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closed";
  /** ISO timestamp, or null while open. */
  closedAt: string | null;
  revision: number;
  current: boolean;
};

export const PayPeriodStatusBadge = ({
  status,
}: {
  status: "open" | "closed";
}) => (
  <Badge tone={toneFor("payPeriod", status)}>
    {status === "closed" ? PAY_PERIOD_COPY.closed : PAY_PERIOD_COPY.open}
  </Badge>
);

const closedLine = (row: PayPeriodTableRow) =>
  row.closedAt
    ? `${formatDateTimeMx(row.closedAt)} · revisión ${row.revision}`
    : row.revision > 0
      ? `Reabierta · ${row.revision} ${row.revision === 1 ? "cierre" : "cierres"}`
      : PAY_PERIOD_COPY.neverClosed;

const href = (row: PayPeriodTableRow) => `/app/periodos/${row.period}`;

/** The quincenas, newest first; a row opens its detail. */
export const PayPeriodsTable = ({ items }: { items: PayPeriodTableRow[] }) => {
  const columns = useMemo<DataTableColumn<PayPeriodTableRow>[]>(
    () => [
      {
        id: "period",
        header: "Quincena",
        accessor: (row) => row.period,
        variant: "primary",
        cell: (row) =>
          row.current ? `${row.label} · ${PAY_PERIOD_COPY.current}` : row.label,
      },
      {
        id: "days",
        header: "Días",
        accessor: (row) => row.startsOn,
        variant: "muted",
        cell: (row) =>
          `${formatDateMx(row.startsOn)} al ${formatDateMx(row.endsOn)}`,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => row.status,
        cell: (row) => <PayPeriodStatusBadge status={row.status} />,
      },
      {
        id: "closed",
        header: "Cierre",
        accessor: (row) => row.closedAt ?? "",
        variant: "muted",
        cell: closedLine,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      emptyTitle="Sin quincenas"
      getRowAriaLabel={(row) => `Ver ${row.label}`}
      getRowHref={href}
      getRowId={(row) => row.period}
      mobileCard={(row) => ({
        title: row.label,
        subtitle: closedLine(row),
        badge: <PayPeriodStatusBadge status={row.status} />,
      })}
      rowTestId="pay-period-row"
      searchable={false}
    />
  );
};
