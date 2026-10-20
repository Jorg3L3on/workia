import type { Metadata } from "next";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { PageHeader } from "@/components/layout/page-header";
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
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";
import { parseListPaging } from "@/lib/list/paging";

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
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const isoDate = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

const AuditoriaPage = async ({ searchParams }: AuditoriaPageProps) => {
  const session = await requireAuditRead();
  const filters = await searchParams;

  const { page, pageSize } = parseListPaging(filters);
  const auditFilters = {
    companyId: session.companyId,
    resourceType: (AUDIT_RESOURCE_TYPES as readonly string[]).includes(
      filters.resourceType ?? "",
    )
      ? filters.resourceType
      : undefined,
    resourceId: filters.resourceId,
    actorUserId: filters.actorUserId,
    action: (AUDIT_ACTIONS as readonly string[]).includes(filters.action ?? "")
      ? filters.action
      : undefined,
    source: (AUDIT_SOURCES as readonly string[]).includes(filters.source ?? "")
      ? (filters.source as (typeof AUDIT_SOURCES)[number])
      : undefined,
    from: isoDate(filters.from)
      ? new Date(`${filters.from}T00:00:00`)
      : undefined,
    to: isoDate(filters.to) ? new Date(`${filters.to}T23:59:59`) : undefined,
    query: filters.q,
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
      <PageHeader
        description="Quién cambió qué, cuándo y sobre qué recurso."
        title="Auditoría"
      />

      <AuditEventList
        events={events}
        server={{
          total,
          page,
          pageSize,
          actors: actorOptions.map((actor) => ({
            id: actor.id,
            label: actor.name ?? actor.email,
          })),
          filters: {
            q: filters.q?.trim() ?? "",
            resourceType: auditFilters.resourceType ?? "",
            resourceId: auditFilters.resourceId ?? "",
            actorUserId: auditFilters.actorUserId ?? "",
            action: auditFilters.action ?? "",
            source: auditFilters.source ?? "",
            from: isoDate(filters.from),
            to: isoDate(filters.to),
          },
        }}
      />
    </div>
  );
};

export default AuditoriaPage;
