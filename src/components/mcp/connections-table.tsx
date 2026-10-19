import { ConnectionRowActions } from "@/components/mcp/connection-row-actions";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import type { ConnectionListItem } from "@/lib/mcp/connections";
import { isMcpScope, scopeLabels } from "@/lib/mcp/scopes";

const connectionState = (connection: ConnectionListItem, now: Date) => {
  if (connection.revokedAt) {
    return { label: "Revocada", active: false };
  }

  const usableUntil =
    connection.kind === "oauth"
      ? (connection.refreshExpiresAt ?? connection.tokenExpiresAt)
      : connection.tokenExpiresAt;

  return usableUntil <= now
    ? { label: "Vencida", active: false }
    : { label: "Activa", active: true };
};

const scopeNames = (scopes: string[]) =>
  scopes
    .filter((scope) => scope !== "offline_access")
    .map((scope) => (isMcpScope(scope) ? scopeLabels[scope].label : scope));

/**
 * The first permission as a chip plus «+N» with the rest in a tooltip, so a
 * connection with many scopes never widens its cell over the next columns.
 */
const ConnectionScopes = ({ scopes }: { scopes: string[] }) => {
  const [first, ...rest] = scopeNames(scopes);

  if (!first) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Badge variant="outline" className="min-w-0 shrink truncate">
        <span className="truncate">{first}</span>
      </Badge>
      {rest.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              asChild
              variant="secondary"
              data-testid="connection-scopes-more"
            >
              <button
                type="button"
                aria-label={`${rest.length} permisos más: ${rest.join(", ")}`}
              >
                +{rest.length}
              </button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{rest.join(", ")}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
};

type ConnectionsTableProps = {
  connections: ConnectionListItem[];
  now: Date;
  showAll: boolean;
  userId: string;
  canCreate: boolean;
  canManage: boolean;
};

/** «Mis conexiones» / «Todas las conexiones» on /app/conexiones. */
export const ConnectionsTable = ({
  connections,
  now,
  showAll,
  userId,
  canCreate,
  canManage,
}: ConnectionsTableProps) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Conexión</TableHead>
        {showAll ? <TableHead>Persona</TableHead> : null}
        <TableHead>Permisos</TableHead>
        <TableHead>Vence</TableHead>
        <TableHead>Último uso</TableHead>
        <TableHead>Estado</TableHead>
        <TableHead className="text-right">Acciones</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {connections.map((connection) => {
        const state = connectionState(connection, now);
        const actionable = connection.userId === userId ? canCreate : canManage;

        return (
          <TableRow key={connection.id} data-testid="connection-row">
            {/* Takes the width the other columns leave and truncates within it. */}
            <TableCell className="w-full max-w-0 min-w-32">
              <div className="truncate font-medium">{connection.name}</div>
              <div className="text-muted-foreground truncate text-xs">
                {connection.kind === "pat"
                  ? "Token personal"
                  : `OAuth · ${connection.clientName}`}
                {connection.isChatgpt ? " · sólo lectura" : ""} ·{" "}
                <span className="font-mono">{connection.tokenPrefix}…</span>
              </div>
            </TableCell>
            {showAll ? (
              <TableCell className="max-w-48 min-w-0">
                <div className="truncate">{connection.userName}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {connection.userEmail}
                </div>
              </TableCell>
            ) : null}
            <TableCell className="max-w-56 min-w-0 text-sm">
              <ConnectionScopes scopes={connection.scopes} />
            </TableCell>
            <TableCell>
              {formatDateMx(
                connection.kind === "oauth"
                  ? (connection.refreshExpiresAt ?? connection.tokenExpiresAt)
                  : connection.tokenExpiresAt,
              )}
            </TableCell>
            <TableCell>{formatDateTimeMx(connection.lastUsedAt)}</TableCell>
            <TableCell>
              <Badge variant={state.active ? "secondary" : "outline"}>
                {state.label}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              {actionable ? (
                <ConnectionRowActions
                  connectionId={connection.id}
                  name={connection.name}
                  active={state.active}
                />
              ) : null}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);
