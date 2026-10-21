"use client";

import { useMemo, useState } from "react";

import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Tag } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { AuditPayload } from "@/lib/audit/types";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  AUDIT_SOURCES,
  auditActionLabels,
  auditFieldLabels,
  auditResourceTypeLabels,
  auditSourceLabels,
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
        `${auditFieldLabels[field] ?? field}: ${formatChangeValue(change.from)} → ${formatChangeValue(change.to)}`,
    )
    .join(" · ");
};

type AuditEventListProps = {
  events: AuditEventRow[];
  emptyMessage?: string;
  layout?: "page" | "inset";
  /**
   * The server already paged and filtered the events (Auditoría); the URL
   * owns paging, the search and every chip.
   */
  server?: {
    total: number;
    page: number;
    pageSize: number;
    filters: AuditFilterValues;
    actors: { id: string; label: string }[];
  };
};

/** Auditoría's URL filters, "" when unset. */
export type AuditFilterValues = {
  q: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string;
  action: string;
  source: string;
  from: string;
  to: string;
};

const AUDIT_FILTER_KEYS = [
  "q",
  "resourceType",
  "resourceId",
  "actorUserId",
  "action",
  "source",
  "from",
  "to",
] as const;

const actionOptions = AUDIT_ACTIONS.map((action) => ({
  value: action,
  label: auditActionLabels[action],
}));

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
  // Embedded lists (expediente, activo) filter the loaded events by action.
  const [localAction, setLocalAction] = useState("");
  const values = server?.filters;
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
      searchAriaLabel="Buscar en eventos"
      searchPlaceholder="Buscar en eventos"
      filterRow={
        server || !localAction ? undefined : (row) => row.action === localAction
      }
      filters={
        values
          ? [
              {
                id: "resourceType",
                label: "Recurso",
                value: values.resourceType,
                onChange: (next) =>
                  controls.setFilter("resourceType", next || null),
                options: AUDIT_RESOURCE_TYPES.map((type) => ({
                  value: type,
                  label: auditResourceTypeLabels[type],
                })),
              },
              {
                id: "action",
                label: "Acción",
                value: values.action,
                onChange: (next) => controls.setFilter("action", next || null),
                options: actionOptions,
              },
              {
                id: "actor",
                label: "Actor",
                value: values.actorUserId,
                onChange: (next) =>
                  controls.setFilter("actorUserId", next || null),
                options: (server?.actors ?? []).map((actor) => ({
                  value: actor.id,
                  label: actor.label,
                })),
              },
              {
                id: "source",
                label: "Origen",
                value: values.source,
                onChange: (next) => controls.setFilter("source", next || null),
                options: AUDIT_SOURCES.map((source) => ({
                  value: source,
                  label: auditSourceLabels[source],
                })),
              },
            ]
          : [
              {
                id: "action",
                label: "Acción",
                value: localAction,
                onChange: setLocalAction,
                options: actionOptions.filter((option) =>
                  events.some((event) => event.action === option.value),
                ),
              },
            ]
      }
      dateRange={
        values
          ? {
              from: values.from,
              to: values.to,
              onChange: ({ from, to }) =>
                controls.setFilters({ from: from || null, to: to || null }),
            }
          : undefined
      }
      advancedFilters={
        values
          ? [
              {
                id: "resourceId",
                label: "ID de recurso",
                value: values.resourceId,
                placeholder: "Pega el identificador del registro",
                onChange: (next) =>
                  controls.setFilter("resourceId", next || null),
              },
            ]
          : undefined
      }
      onClearFilters={
        server
          ? () =>
              controls.setFilters(
                Object.fromEntries(AUDIT_FILTER_KEYS.map((key) => [key, null])),
              )
          : () => setLocalAction("")
      }
      server={
        server
          ? {
              total: server.total,
              page: server.page,
              pageSize: server.pageSize,
              query: server.filters.q,
              hasFilters: Object.values(server.filters).some(Boolean),
              onQueryChange: controls.setQuery,
              onPageChange: controls.setPage,
              onPageSizeChange: controls.setPageSize,
            }
          : undefined
      }
    />
  );
};
