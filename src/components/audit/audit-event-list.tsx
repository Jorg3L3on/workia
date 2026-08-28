import type { AuditPayload } from "@/lib/audit/types";
import {
  auditActionLabels,
  auditResourceTypeLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";

import { ListStatusBadge } from "@/components/list/list-status-badge";
import {
  ListEmptyState,
  listTableDensityClassName,
} from "@/components/list/list-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AuditEventRow = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  resourceType: string;
  resourceId: string;
  action: string;
  result: string;
  payload: AuditPayload | null;
  occurredAt: Date;
};

const formatOccurredAt = (value: Date) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const formatChangeValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  return String(value);
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
};

export const AuditEventList = ({
  events,
  emptyMessage = "Sin eventos de auditoría.",
}: AuditEventListProps) => {
  if (events.length === 0) {
    return <ListEmptyState title={emptyMessage} />;
  }

  return (
    <Table className={listTableDensityClassName}>
      <TableHeader>
        <TableRow>
          <TableHead>Cuándo</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Recurso</TableHead>
          <TableHead>Acción</TableHead>
          <TableHead>Detalle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatOccurredAt(event.occurredAt)}
            </TableCell>
            <TableCell>
              <div className="font-medium">{event.actorName ?? "Sistema"}</div>
              {event.actorEmail ? (
                <div className="text-muted-foreground text-xs">
                  {event.actorEmail}
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              <ListStatusBadge tone="neutral">
                {auditResourceTypeLabels[
                  event.resourceType as AuditResourceType
                ] ?? event.resourceType}
              </ListStatusBadge>
            </TableCell>
            <TableCell>
              {auditActionLabels[event.action as AuditAction] ?? event.action}
            </TableCell>
            <TableCell className="text-muted-foreground max-w-md text-xs whitespace-normal">
              {renderChanges(event.payload)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
