import type { Metadata } from "next";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { ListFilterBar } from "@/components/list/list-filter-bar";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
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
      <ListPageHeader
        description="Quién cambió qué, cuándo y sobre qué recurso."
        descriptionSecondary="Lista de eventos de auditoría registrados."
        title="Auditoría"
      />

      <ListFilterBar className="md:grid md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="resourceType">
            Tipo de recurso
          </label>
          <FormSelect
            defaultValue={filters.resourceType ?? ""}
            id="resourceType"
            name="resourceType"
            options={[
              { value: "", label: "Todos" },
              ...AUDIT_RESOURCE_TYPES.map((type) => ({
                value: type,
                label: auditResourceTypeLabels[type],
              })),
            ]}
          />
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
          <FormSelect
            defaultValue={filters.actorUserId ?? ""}
            id="actorUserId"
            name="actorUserId"
            options={[
              { value: "", label: "Todos" },
              ...actorOptions.map((actor) => ({
                value: actor.id,
                label: `${actor.name} (${actor.email})`,
              })),
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="action">
            Acción
          </label>
          <FormSelect
            defaultValue={filters.action ?? ""}
            id="action"
            name="action"
            options={[
              { value: "", label: "Todas" },
              ...AUDIT_ACTIONS.map((action) => ({
                value: action,
                label: auditActionLabels[action],
              })),
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="from">
            Desde
          </label>
          <DateInput defaultValue={filters.from ?? ""} id="from" name="from" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="to">
            Hasta
          </label>
          <DateInput defaultValue={filters.to ?? ""} id="to" name="to" />
        </div>

        <div className="flex items-end md:col-span-2 xl:col-span-3">
          <Button className="h-10 rounded-full" type="submit" variant="outline">
            Filtrar
          </Button>
        </div>
      </ListFilterBar>

      <AuditEventList events={events} />
    </div>
  );
};

export default AuditoriaPage;
