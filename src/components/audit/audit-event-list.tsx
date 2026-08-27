import type { AuditPayload } from "@/lib/audit/types";
import {
  auditActionLabels,
  auditResourceTypeLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";
import { Badge } from "@/components/ui/badge";
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
    return (
      <div className="workia-empty-state m-4 px-4 py-8 text-center">
        <p className="text-sm font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <Table>
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
            <TableCell className="text-sm whitespace-nowrap">
              {formatOccurredAt(event.occurredAt)}
            </TableCell>
            <TableCell className="text-sm">
              <div className="font-medium">{event.actorName ?? "Sistema"}</div>
              {event.actorEmail ? (
                <div className="text-muted-foreground text-xs">
                  {event.actorEmail}
                </div>
              ) : null}
            </TableCell>
            <TableCell className="text-sm">
              <Badge variant="outline">
                {auditResourceTypeLabels[
                  event.resourceType as AuditResourceType
                ] ?? event.resourceType}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">
              {auditActionLabels[event.action as AuditAction] ?? event.action}
            </TableCell>
            <TableCell className="text-muted-foreground max-w-md text-xs">
              {renderChanges(event.payload)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
