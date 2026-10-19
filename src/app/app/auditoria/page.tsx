import type { Metadata } from "next";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { ListFilterBar } from "@/components/list/list-filter-bar";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { ListPager } from "@/components/list/list-pager";
import {
  countAuditEvents,
  listAuditActors,
  listAuditEvents,
} from "@/lib/audit";
import { requireAuditRead } from "@/lib/audit/auth";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  AUDIT_SOURCES,
  auditActionLabels,
  auditResourceTypeLabels,
  auditSourceLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";
import { pageCountFor, parseListPaging } from "@/lib/list/paging";

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
    source?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const AuditoriaPage = async ({ searchParams }: AuditoriaPageProps) => {
  const session = await requireAuditRead();
  const filters = await searchParams;

  const { page, pageSize } = parseListPaging(filters);
  const auditFilters = {
    companyId: session.companyId,
    resourceType: filters.resourceType,
    resourceId: filters.resourceId,
    actorUserId: filters.actorUserId,
    action: filters.action,
    source: (AUDIT_SOURCES as readonly string[]).includes(filters.source ?? "")
      ? (filters.source as (typeof AUDIT_SOURCES)[number])
      : undefined,
    from: filters.from ? new Date(`${filters.from}T00:00:00`) : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`) : undefined,
  };

  const [events, total, actorOptions] = await Promise.all([
    listAuditEvents({
      ...auditFilters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    countAuditEvents(auditFilters),
    listAuditActors(session.companyId),
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
            className="bg-card h-10"
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
          <label className="text-sm font-medium" htmlFor="source">
            Origen
          </label>
          <FormSelect
            defaultValue={filters.source ?? ""}
            id="source"
            name="source"
            options={[
              { value: "", label: "Todos" },
              ...AUDIT_SOURCES.map((source) => ({
                value: source,
                label: auditSourceLabels[source],
              })),
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="from">
            Desde
          </label>
          <DateInput
            className="bg-card h-10"
            defaultValue={filters.from ?? ""}
            id="from"
            name="from"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="to">
            Hasta
          </label>
          <DateInput
            className="bg-card h-10"
            defaultValue={filters.to ?? ""}
            id="to"
            name="to"
          />
        </div>

        <div className="flex items-end md:col-span-2 xl:col-span-3">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
        </div>
      </ListFilterBar>

      <AuditEventList events={events} pageSize={pageSize} />

      <ListPager
        page={page}
        pageCount={pageCountFor(total, pageSize)}
        params={{
          resourceType: filters.resourceType,
          resourceId: filters.resourceId,
          actorUserId: filters.actorUserId,
          action: filters.action,
          source: filters.source,
          from: filters.from,
          to: filters.to,
        }}
        pathname="/app/auditoria"
      />
    </div>
  );
};

export default AuditoriaPage;
