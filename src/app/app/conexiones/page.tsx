import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { CopyConnectorUrlButton } from "@/components/mcp/copy-connector-url-button";
import {
  ConnectionsDataTable,
  ToolCallsDataTable,
} from "@/components/mcp/connections-data-table";
import { CreateTokenSheet } from "@/components/mcp/create-token-sheet";
import { WritesSwitch } from "@/components/mcp/writes-switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <div className="flex flex-col gap-4">
        <PageHeader
          description={`Asistentes de IA conectados a ${session.membership.companyName}; cada conexión ve sólo esta empresa y nunca más de lo que permite tu rol.`}
          primary={
            canCreate ? (
              <CreateTokenSheet
                grantable={grantableScopes(session.permissions)}
                mcpUrl={mcpUrl}
              />
            ) : null
          }
          secondary={
            // Phones read the URL in the «Nuevo token» sheet.
            <div className="hidden md:block">
              <CopyConnectorUrlButton url={mcpUrl} />
            </div>
          }
          title="Conexiones"
        />
        {canManage ? (
          <WritesSwitch
            enabled={settings.writesEnabled}
            canToggle={session.membership.roleSlug === "super_admin"}
          />
        ) : null}
      </div>

      {!isMcpEnabled() ? (
        <p
          role="status"
          className="workia-pass-card text-muted-foreground p-4 text-sm"
        >
          El conector está apagado (MCP_ENABLED). Las conexiones no responden.
        </p>
      ) : null}

      <Tabs className="gap-4" defaultValue="conexiones">
        <TabsList
          className="h-9 w-full justify-start bg-transparent p-0"
          variant="line"
        >
          <TabsTrigger className="flex-none px-3" value="conexiones">
            Conexiones
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="actividad">
            Actividad
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conexiones">
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
            canSeeAll={canManage}
            showOwner={showAll}
          />
        </TabsContent>
        <TabsContent className="space-y-4" value="actividad">
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
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConexionesPage;
