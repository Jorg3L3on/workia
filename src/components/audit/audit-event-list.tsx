"use client";

import { useMemo } from "react";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Tag } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
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
  source?: string;
  requestMeta?: unknown;
};

/** «MCP · Grok Bot» for changes made by an assistant through the connector. */
const mcpBadgeLabel = (row: AuditEventRow) => {
  if (row.source !== "mcp") {
    return null;
  }

  const client =
    row.requestMeta && typeof row.requestMeta === "object"
      ? (row.requestMeta as { client?: unknown }).client
      : undefined;

  return typeof client === "string" && client ? `MCP · ${client}` : "MCP";
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
  /** The server already paged the events (Auditoría); the URL owns paging. */
  server?: {
    total: number;
    page: number;
    pageSize: number;
    hasFilters: boolean;
  };
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
  server,
}: AuditEventListProps) => {
  const controls = useServerListControls();
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
        variant: "muted",
        cell: (row) => row.occurredLabel,
      },
      {
        id: "actor",
        header: "Actor",
        accessor: (row) => row.actorLabel,
        cell: (row) => (
          <div>
            <div className="text-foreground flex flex-wrap items-center gap-1.5">
              {row.actorLabel}
              {mcpBadgeLabel(row) ? <Tag>{mcpBadgeLabel(row)}</Tag> : null}
            </div>
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
        cell: (row) => <Tag>{row.resourceLabel}</Tag>,
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
        variant: "muted",
        truncate: true,
        cellClassName: "max-w-md",
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
          mcpBadgeLabel(row) ?? "",
          row.resourceLabel,
          row.actionLabel,
          row.detail,
        ].join(" ")
      }
      layout={layout}
      mobileCard={(row) => ({
        title: `${row.actionLabel} · ${row.resourceLabel}`,
        subtitle: `${row.occurredLabel} · ${row.actorLabel}`,
      })}
      pageSizes={server ? controls.pageSizes : undefined}
      searchable={!server}
      searchPlaceholder="Buscar en los eventos"
      server={
        server
          ? {
              ...server,
              onPageChange: controls.setPage,
              onPageSizeChange: controls.setPageSize,
            }
          : undefined
      }
    />
  );
};
