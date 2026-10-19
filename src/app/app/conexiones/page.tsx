import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { ListPageHeader } from "@/components/list/list-page-header";
import { ConnectionsTable } from "@/components/mcp/connections-table";
import { CreateTokenForm } from "@/components/mcp/create-token-form";
import { WritesSwitch } from "@/components/mcp/writes-switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateTimeMx } from "@/lib/format/date";
import {
  isMcpEnabled,
  MCP_RESOURCE_PATH,
  publicOrigin,
} from "@/lib/mcp/config";
import {
  countToolCallErrors,
  listConnections,
  listToolCalls,
} from "@/lib/mcp/connections";
import { currentRequest } from "@/lib/mcp/request-origin";
import { grantableScopes } from "@/lib/mcp/scopes";
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

        {connections.length === 0 ? (
          <p className="workia-empty-state text-muted-foreground p-6 text-center text-sm">
            Aún no hay conexiones.
          </p>
        ) : (
          <ConnectionsTable
            connections={connections}
            now={now}
            showAll={showAll}
            userId={session.userId}
            canCreate={canCreate}
            canManage={canManage}
          />
        )}
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
        {calls.length === 0 ? (
          <p className="workia-empty-state text-muted-foreground p-6 text-center text-sm">
            Sin llamadas todavía.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Herramienta</TableHead>
                <TableHead>Conexión</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="text-right">ms</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id} data-testid="tool-call-row">
                  <TableCell>{formatDateTimeMx(call.occurredAt)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.tool}
                  </TableCell>
                  <TableCell>
                    <div>{call.connectionName}</div>
                    {showAll ? (
                      <div className="text-muted-foreground text-xs">
                        {call.userName}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        call.result === "success" ? "secondary" : "outline"
                      }
                    >
                      {call.result === "success"
                        ? "Correcto"
                        : call.result === "denied"
                          ? `Rechazado · ${call.errorCode}`
                          : `Error · ${call.errorCode}`}
                    </Badge>
                    {call.piiUnmasked ? (
                      <span className="text-muted-foreground ml-2 text-xs">
                        datos personales completos
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {call.latencyMs}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
};

export default ConexionesPage;
