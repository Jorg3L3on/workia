import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { ListPageHeader } from "@/components/list/list-page-header";
import {
  ConnectionsDataTable,
  ToolCallsDataTable,
} from "@/components/mcp/connections-data-table";
import { CreateTokenForm } from "@/components/mcp/create-token-form";
import { WritesSwitch } from "@/components/mcp/writes-switch";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  isMcpEnabled,
  MCP_RESOURCE_PATH,
  publicOrigin,
} from "@/lib/mcp/config";
import {
  countToolCallErrors,
  listConnections,
  listToolCalls,
  type ConnectionListItem,
} from "@/lib/mcp/connections";
import { currentRequest } from "@/lib/mcp/request-origin";
import { grantableScopes, isMcpScope, scopeLabels } from "@/lib/mcp/scopes";
import { getMcpSettings } from "@/lib/mcp/settings";
import { requireCompanyPage } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.conexiones,
};

type ConexionesPageProps = {
  searchParams: Promise<{ vista?: string }>;
};

const connectionState = (connection: ConnectionListItem, now: Date) => {
  if (connection.revokedAt) {
    return { label: "Revocada", status: "revocada", active: false };
  }

  const usableUntil =
    connection.kind === "oauth"
      ? (connection.refreshExpiresAt ?? connection.tokenExpiresAt)
      : connection.tokenExpiresAt;

  return usableUntil <= now
    ? { label: "Vencida", status: "vencida", active: false }
    : { label: "Activa", status: "activa", active: true };
};

const scopeList = (scopes: string[]) =>
  scopes
    .filter((scope) => scope !== "offline_access")
    .map((scope) => (isMcpScope(scope) ? scopeLabels[scope].label : scope));

/** The app's own origin, for the snippets (MCP_PUBLIC_URL wins). */
const currentOrigin = async () => publicOrigin(await currentRequest());

/**
 * AI assistant connections of the active company (addendum §6): personal tokens
 * and OAuth grants, their activity, and revocation.
 */
const ConexionesPage = async ({ searchParams }: ConexionesPageProps) => {
  const session = await requireCompanyPage();
  const canCreate = session.permissions.has("mcp_connections:create");
  const canManage = session.permissions.has("mcp_connections:manage");

  if (!canCreate && !canManage) {
    forbidden();
  }

  const { vista } = await searchParams;
  const showAll = canManage && vista === "todas";
  const scopeFilter = showAll ? {} : { userId: session.userId };
  const now = new Date();
  const [connections, calls, errors24h, origin, settings] = await Promise.all([
    listConnections(session.companyId, scopeFilter),
    listToolCalls(session.companyId, { ...scopeFilter, limit: 50 }),
    countToolCallErrors(
      session.companyId,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      scopeFilter,
    ),
    currentOrigin(),
    getMcpSettings(session.companyId),
  ]);
  const mcpUrl = `${origin}${MCP_RESOURCE_PATH}`;

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        title="Conexiones"
        description={`Asistentes de IA (Grok Bot, ChatGPT, Cursor, Claude) conectados a ${session.membership.companyName}. Cada conexión ve sólo esta empresa y nunca más de lo que permite tu rol.`}
        descriptionSecondary={
          <>
            URL del conector: <code className="font-mono">{mcpUrl}</code>
          </>
        }
      />

      {!isMcpEnabled() ? (
        <p
          role="status"
          className="workia-pass-card text-muted-foreground p-4 text-sm"
        >
          El conector está apagado (MCP_ENABLED). Las conexiones no responden.
        </p>
      ) : null}

      {canManage ? (
        <section className="workia-pass-card p-5">
          <WritesSwitch
            enabled={settings.writesEnabled}
            canToggle={session.membership.roleSlug === "super_admin"}
          />
        </section>
      ) : null}

      {canCreate ? (
        <section
          className="workia-pass-card space-y-4 p-5"
          aria-labelledby="nuevo-token"
        >
          <div className="space-y-1">
            <h2 id="nuevo-token" className="text-lg font-semibold">
              Nuevo token personal
            </h2>
            <p className="text-muted-foreground text-sm">
              Para Grok Bot, Cursor o el MCP Inspector. ChatGPT y Claude se
              conectan con OAuth desde su configuración, con la URL de arriba.
            </p>
          </div>
          <CreateTokenForm
            grantable={grantableScopes(session.permissions)}
            mcpUrl={mcpUrl}
          />
        </section>
      ) : null}

      <section
        className="workia-pass-card space-y-4 p-5"
        aria-labelledby="lista-conexiones"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="lista-conexiones" className="text-lg font-semibold">
            {showAll ? "Todas las conexiones" : "Mis conexiones"}
          </h2>
          {canManage ? (
            <nav className="flex gap-1 text-sm" aria-label="Vista">
              {[
                {
                  href: "/app/conexiones",
                  label: "Mis conexiones",
                  on: !showAll,
                },
                {
                  href: "/app/conexiones?vista=todas",
                  label: "Todas",
                  on: showAll,
                },
              ].map((tab) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={tab.on ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5",
                    tab.on
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>

        <ConnectionsDataTable
          connections={connections.map((connection) => {
            const state = connectionState(connection, now);

            return {
              id: connection.id,
              name: connection.name,
              detail: [
                connection.kind === "pat"
                  ? "Token personal"
                  : `OAuth · ${connection.clientName}`,
                connection.isChatgpt ? "sólo lectura" : null,
                `${connection.tokenPrefix}…`,
              ]
                .filter(Boolean)
                .join(" · "),
              userName: connection.userName,
              userEmail: connection.userEmail,
              scopes: scopeList(connection.scopes),
              expiresAt: (connection.kind === "oauth"
                ? (connection.refreshExpiresAt ?? connection.tokenExpiresAt)
                : connection.tokenExpiresAt
              ).toISOString(),
              lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
              stateLabel: state.label,
              status: state.status,
              active: state.active,
              actionable:
                connection.userId === session.userId ? canCreate : canManage,
            };
          })}
          showOwner={showAll}
        />
      </section>

      <section
        className="workia-pass-card space-y-4 p-5"
        aria-labelledby="actividad"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 id="actividad" className="text-lg font-semibold">
              Actividad
            </h2>
            <p className="text-muted-foreground text-sm">
              Últimas 50 llamadas · {errors24h}{" "}
              {errors24h === 1 ? "error o rechazo" : "errores o rechazos"} en 24
              h. Los cambios que hagan los asistentes quedan en la{" "}
              <Link
                href="/app/auditoria"
                className="underline underline-offset-2"
              >
                auditoría
              </Link>
              .
            </p>
          </div>
        </div>
        <ToolCallsDataTable
          calls={calls.map((call) => ({
            id: call.id,
            occurredAt: call.occurredAt.toISOString(),
            tool: call.tool,
            connectionName: call.connectionName,
            userName: call.userName,
            result: call.result,
            resultLabel:
              call.result === "success"
                ? "Correcto"
                : call.result === "denied"
                  ? `Rechazado · ${call.errorCode}`
                  : `Error · ${call.errorCode}`,
            piiUnmasked: call.piiUnmasked,
            latencyMs: call.latencyMs,
          }))}
          showOwner={showAll}
        />
      </section>
    </div>
  );
};

export default ConexionesPage;
