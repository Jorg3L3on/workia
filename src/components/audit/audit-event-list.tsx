"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/list/data-table";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import type { AuditPayload } from "@/lib/audit/types";
import {
  auditActionLabels,
  auditResourceTypeLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";
import { formatDateTimeMx, formatStoredDateValue } from "@/lib/format/date";

export type AuditEventRow = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  resourceType: string;
  resourceId: string;
  action: string;
  result: string;
  payload: AuditPayload | null;
  occurredAt: Date | string;
};

const formatOccurredAt = (value: Date | string) => formatDateTimeMx(value);

const formatChangeValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  return formatStoredDateValue(value) ?? String(value);
};

const renderChanges = (payload: AuditPayload | null) => {
  if (!payload?.changes || Object.keys(payload.changes).length === 0) {
    return payload?.summary ?? "—";
  }

  return Object.entries(payload.changes)
    .map(
      ([field, change]) =>
        `${field}: ${formatChangeValue(change.from)} → ${formatChangeValue(change.to)}`,
    )
    .join(" · ");
};

type AuditEventListProps = {
  events: AuditEventRow[];
  emptyMessage?: string;
  layout?: "page" | "inset";
};

type AuditTableRow = AuditEventRow & {
  occurredLabel: string;
  actorLabel: string;
  resourceLabel: string;
  actionLabel: string;
  detail: string;
};

export const AuditEventList = ({
  events,
  emptyMessage = "Sin eventos de auditoría.",
  layout = "page",
}: AuditEventListProps) => {
  const rows = useMemo<AuditTableRow[]>(
    () =>
      events.map((event) => ({
        ...event,
        occurredLabel: formatOccurredAt(event.occurredAt),
        actorLabel: event.actorName ?? "Sistema",
        resourceLabel:
          auditResourceTypeLabels[event.resourceType as AuditResourceType] ??
          event.resourceType,
        actionLabel:
          auditActionLabels[event.action as AuditAction] ?? event.action,
        detail: renderChanges(event.payload),
      })),
    [events],
  );

  const columns = useMemo<DataTableColumn<AuditTableRow>[]>(
    () => [
      {
        id: "when",
        header: "Cuándo",
        accessor: (row) =>
          typeof row.occurredAt === "string"
            ? row.occurredAt
            : row.occurredAt.toISOString(),
        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.occurredLabel}
          </span>
        ),
      },
      {
        id: "actor",
        header: "Actor",
        accessor: (row) => row.actorLabel,
        cell: (row) => (
          <div>
            <div className="font-medium">{row.actorLabel}</div>
            {row.actorEmail ? (
              <div className="text-muted-foreground text-xs">
                {row.actorEmail}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "resource",
        header: "Recurso",
        accessor: (row) => row.resourceLabel,
        cell: (row) => (
          <ListStatusBadge tone="neutral">{row.resourceLabel}</ListStatusBadge>
        ),
      },
      {
        id: "action",
        header: "Acción",
        accessor: (row) => row.actionLabel,
      },
      {
        id: "detail",
        header: "Detalle",
        accessor: (row) => row.detail,
        cell: (row) => (
          <span className="text-muted-foreground max-w-md text-xs whitespace-normal">
            {row.detail}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyTitle={emptyMessage}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        [
          row.occurredLabel,
          row.actorLabel,
          row.resourceLabel,
          row.actionLabel,
          row.detail,
        ].join(" ")
      }
      layout={layout}
      resultPlural="eventos"
      resultSingular="evento"
      searchPlaceholder="Buscar en los eventos cargados"
    />
  );
};
