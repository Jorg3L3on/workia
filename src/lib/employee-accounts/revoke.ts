import { and, eq, inArray, ne } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import type { RecordAuditEventInput } from "@/lib/audit/types";
import type { DbTransaction } from "@/lib/db";
import {
  employeeAccounts,
  employeeCodes,
  employeeSessions,
  type EmployeeDisabledReason,
} from "@/lib/db/schema";
import { endManagerAccess } from "@/lib/managers";
import { withTenant } from "@/lib/tenant/scope";

const reasonSummaries: Record<EmployeeDisabledReason, string> = {
  baja: "Cuenta de empleado desactivada por la baja",
  borrado: "Cuenta de empleado desactivada por el borrado del expediente",
  rrhh: "Cuenta de empleado desactivada por RH",
};

/**
 * Disables the person's live employee account and deletes its sessions and
 * codes, inside the caller's transaction (W2-01). A baja (recordTermination)
 * and a borrado (softDeletePerson) call it in the same transaction as the
 * change, so the account is off the moment the change commits. Audited.
 * Returns how many accounts it disabled (0 or 1).
 */
export const revokeEmployeeAccess = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  reason: EmployeeDisabledReason,
  actorUserId?: string | null,
  source?: RecordAuditEventInput["source"],
) => {
  const disabled = await tx
    .update(employeeAccounts)
    .set({ status: "disabled", disabledAt: new Date(), disabledReason: reason })
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.personId, personId),
        ne(employeeAccounts.status, "disabled"),
      ),
    )
    .returning({ id: employeeAccounts.id, status: employeeAccounts.status });

  if (disabled.length === 0) {
    return 0;
  }

  const ids = disabled.map((account) => account.id);

  // A manager grant and the delegations from or to the account end with it (W2-07).
  await endManagerAccess(tx, companyId, ids, actorUserId ?? null);

  await tx
    .delete(employeeSessions)
    .where(
      and(
        eq(employeeSessions.companyId, companyId),
        inArray(employeeSessions.accountId, ids),
      ),
    );
  await tx
    .delete(employeeCodes)
    .where(
      and(
        eq(employeeCodes.companyId, companyId),
        inArray(employeeCodes.accountId, ids),
      ),
    );

  for (const id of ids) {
    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "employee_account",
        resourceId: id,
        action: "deactivate",
        source,
        payload: {
          after: { personId, status: "disabled", disabledReason: reason },
          summary: reasonSummaries[reason],
        },
      },
      tx,
    );
  }

  return disabled.length;
};
