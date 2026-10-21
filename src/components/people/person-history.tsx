import { AuditEventList } from "@/components/audit/audit-event-list";
import { listAuditEvents } from "@/lib/audit";

/** The expediente's history from the audit log (audit:read is checked by the page). */
export const PersonHistory = async ({
  companyId,
  personId,
}: {
  companyId: string;
  personId: string;
}) => {
  const auditEvents = await listAuditEvents({
    companyId,
    resourceType: "person",
    resourceId: personId,
    limit: 50,
  });

  return (
    <AuditEventList
      emptyMessage="Aún no hay cambios registrados para esta persona."
      events={auditEvents}
      layout="inset"
    />
  );
};
