import type { Metadata } from "next";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { ListFilterBar } from "@/components/list/list-filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAuditEvents } from "@/lib/audit";
import { requireAuditRead } from "@/lib/audit/auth";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  auditActionLabels,
  auditResourceTypeLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.auditoria,
};

type AuditoriaPageProps = {
  searchParams: Promise<{
    resourceType?: AuditResourceType;
    resourceId?: string;
    actorUserId?: string;
    action?: AuditAction;
    from?: string;
    to?: string;
  }>;
};

const AuditoriaPage = async ({ searchParams }: AuditoriaPageProps) => {
  await requireAuditRead();
  const filters = await searchParams;

  const [events, actorOptions] = await Promise.all([
    listAuditEvents({
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      from: filters.from ? new Date(`${filters.from}T00:00:00`) : undefined,
      to: filters.to ? new Date(`${filters.to}T23:59:59`) : undefined,
      limit: 200,
    }),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Trazabilidad
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoría</h1>
        <p className="text-muted-foreground text-sm">
          Quién cambió qué, cuándo y sobre qué recurso.
        </p>
      </header>

      <ListFilterBar className="md:grid md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="resourceType">
            Tipo de recurso
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={filters.resourceType ?? ""}
            id="resourceType"
            name="resourceType"
          >
            <option value="">Todos</option>
            {AUDIT_RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {auditResourceTypeLabels[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="resourceId">
            ID de recurso
          </label>
          <Input
            defaultValue={filters.resourceId ?? ""}
            id="resourceId"
            name="resourceId"
            placeholder="UUID del recurso"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="actorUserId">
            Actor
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={filters.actorUserId ?? ""}
            id="actorUserId"
            name="actorUserId"
          >
            <option value="">Todos</option>
            {actorOptions.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name} ({actor.email})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="action">
            Acción
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={filters.action ?? ""}
            id="action"
            name="action"
          >
            <option value="">Todas</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {auditActionLabels[action]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="from">
            Desde
          </label>
          <Input
            defaultValue={filters.from ?? ""}
            id="from"
            name="from"
            type="date"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="to">
            Hasta
          </label>
          <Input
            defaultValue={filters.to ?? ""}
            id="to"
            name="to"
            type="date"
          />
        </div>

        <div className="flex items-end md:col-span-2 xl:col-span-3">
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </div>
      </ListFilterBar>

      <AuditEventList events={events} />
    </div>
  );
};

export default AuditoriaPage;
