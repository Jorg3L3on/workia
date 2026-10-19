"use client";

import { EyeOffIcon, UnplugIcon } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import { Badge, Tag } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hideConnectionAction,
  revokeConnectionAction,
  type ConnectionActionState,
} from "@/lib/mcp/actions";
import { toneFor } from "@/lib/ui/status-tone";

export type ConnectionRow = {
  id: string;
  name: string;
  /** «Token personal · wk_ab…» or «OAuth · ChatGPT · sólo lectura». */
  detail: string;
  userName: string | null;
  userEmail: string | null;
  scopes: string[];
  /** ISO timestamps. */
  expiresAt: string;
  lastUsedAt: string | null;
  stateLabel: string;
  status: string;
  active: boolean;
  actionable: boolean;
};

export type ToolCallRow = {
  id: string;
  occurredAt: string;
  tool: string;
  connectionName: string | null;
  userName: string | null;
  result: string;
  resultLabel: string;
  piiUnmasked: boolean;
  latencyMs: number;
};

const useResultToast = (state: ConnectionActionState, success: string) => {
  const last = useRef<ConnectionActionState | null>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success(success);
  }, [state, success]);
};

/** «Leer +4»: the first permission and how many more, all in the tooltip. */
export const ScopeChips = ({ scopes }: { scopes: string[] }) => {
  if (scopes.length === 0) {
    return <span className="text-muted-foreground/70">—</span>;
  }

  const [first, ...rest] = scopes;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={scopes.join(", ")}
            className="inline-flex max-w-full min-w-0 items-center gap-1"
            tabIndex={0}
          >
            <Tag className="max-w-32">{first}</Tag>
            {rest.length > 0 ? <Tag>+{rest.length}</Tag> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{scopes.join(", ")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/** Revoke (with confirmation) while active; hide once revoked or expired. */
const ConnectionRowMenu = ({ row }: { row: ConnectionRow }) => {
  const [revokeState, revoke] = useActionState(revokeConnectionAction, {});
  const [hideState, hide] = useActionState(hideConnectionAction, {});

  useResultToast(revokeState, "Conexión revocada.");
  useResultToast(hideState, "Conexión oculta.");

  const fields = (
    <>
      <CompanyField />
      <input type="hidden" name="connectionId" value={row.id} />
    </>
  );

  return (
    <RowMenu
      actions={[
        row.active
          ? {
              label: "Revocar",
              icon: UnplugIcon,
              destructive: true,
              action: revoke,
              fields,
              confirm: {
                title: `¿Revocar «${row.name}»?`,
                description:
                  "El asistente pierde el acceso en su siguiente llamada. Para volver a usarlo hay que conectarlo de nuevo.",
                confirmLabel: "Revocar",
              },
            }
          : {
              label: "Ocultar",
              icon: EyeOffIcon,
              action: hide,
              fields,
            },
      ]}
      label={`Acciones de ${row.name}`}
    />
  );
};

const ConnectionState = ({ row }: { row: ConnectionRow }) => (
  <Badge tone={toneFor("connection", row.status)}>{row.stateLabel}</Badge>
);

export const ConnectionsDataTable = ({
  connections,
  showOwner,
}: {
  connections: ConnectionRow[];
  /** «Todas»: who each connection belongs to. */
  showOwner: boolean;
}) => {
  const columns: DataTableColumn<ConnectionRow>[] = [
    {
      id: "name",
      header: "Conexión",
      accessor: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <div className="text-foreground truncate">{row.name}</div>
          <div className="text-muted-foreground truncate text-xs">
            {row.detail}
          </div>
        </div>
      ),
      cellClassName: "max-w-64",
    },
    ...(showOwner
      ? [
          {
            id: "owner",
            header: "Persona",
            accessor: (row: ConnectionRow) => row.userName ?? "",
            cell: (row: ConnectionRow) => (
              <div className="min-w-0">
                <div className="truncate">{row.userName}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {row.userEmail}
                </div>
              </div>
            ),
            cellClassName: "max-w-48",
          } satisfies DataTableColumn<ConnectionRow>,
        ]
      : []),
    {
      id: "scopes",
      header: "Permisos",
      accessor: (row) => row.scopes.join(" "),
      cell: (row) => <ScopeChips scopes={row.scopes} />,
      enableSorting: false,
      cellClassName: "max-w-48",
    },
    {
      id: "expires",
      header: "Vence",
      accessor: (row) => row.expiresAt.slice(0, 10),
      variant: "muted",
    },
    {
      id: "lastUsed",
      header: "Último uso",
      accessor: (row) => row.lastUsedAt,
      variant: "muted",
    },
    {
      id: "state",
      header: "Estado",
      accessor: (row) => row.stateLabel,
      cell: (row) => <ConnectionState row={row} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={connections}
      emptyTitle="Aún no hay conexiones"
      getRowId={(row) => row.id}
      layout="inset"
      mobileCard={(row) => ({
        title: row.name,
        subtitle: row.detail,
        badge: <ConnectionState row={row} />,
      })}
      rowMenu={(row) =>
        row.actionable ? <ConnectionRowMenu row={row} /> : null
      }
      rowTestId="connection-row"
      searchPlaceholder="Buscar conexión"
    />
  );
};

const ToolCallResult = ({ row }: { row: ToolCallRow }) => (
  <Badge tone={toneFor("toolCall", row.result)}>{row.resultLabel}</Badge>
);

/** The last calls of the connector (the raw tool name stays as is until F7). */
export const ToolCallsDataTable = ({
  calls,
  showOwner,
}: {
  calls: ToolCallRow[];
  showOwner: boolean;
}) => {
  const columns: DataTableColumn<ToolCallRow>[] = [
    {
      id: "when",
      header: "Fecha",
      accessor: (row) => row.occurredAt,
      variant: "muted",
    },
    {
      id: "tool",
      header: "Herramienta",
      accessor: (row) => row.tool,
      cell: (row) => <span className="font-mono text-xs">{row.tool}</span>,
    },
    {
      id: "connection",
      header: "Conexión",
      accessor: (row) => row.connectionName ?? "",
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate">{row.connectionName ?? "—"}</div>
          {showOwner && row.userName ? (
            <div className="text-muted-foreground truncate text-xs">
              {row.userName}
            </div>
          ) : null}
        </div>
      ),
      cellClassName: "max-w-48",
    },
    {
      id: "result",
      header: "Resultado",
      accessor: (row) => row.resultLabel,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <ToolCallResult row={row} />
          {row.piiUnmasked ? (
            <span className="text-muted-foreground text-xs">
              datos personales completos
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "latency",
      header: "ms",
      accessor: (row) => row.latencyMs,
      variant: "numeric",
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={calls}
      emptyTitle="Sin llamadas todavía"
      getRowId={(row) => row.id}
      layout="inset"
      mobileCard={(row) => ({
        title: row.tool,
        subtitle: [row.connectionName, `${row.latencyMs} ms`]
          .filter(Boolean)
          .join(" · "),
        badge: <ToolCallResult row={row} />,
      })}
      rowTestId="tool-call-row"
      searchPlaceholder="Buscar herramienta o conexión"
    />
  );
};
