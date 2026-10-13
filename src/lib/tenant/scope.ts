/**
 * Company filters for business queries (adapted from ZigZag's tenant helpers).
 *
 * Drizzle does not scope queries by itself: every read and write of a business
 * table must filter by the active company. These helpers keep that filter
 * uniform and hard to forget, and guard rows loaded by id.
 *
 *   db.select().from(people).where(withTenant(people, companyId, isNull(people.deletedAt)))
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { AuthorizationError } from "@/lib/rbac/errors";

export type TenantTable = { companyId: AnyPgColumn };

/** `company_id = :companyId`. */
export const tenantScope = (table: TenantTable, companyId: string): SQL =>
  eq(table.companyId, companyId);

/** The company filter AND every other condition, in one call. */
export const withTenant = (
  table: TenantTable,
  companyId: string,
  ...conditions: Array<SQL | undefined>
): SQL => and(tenantScope(table, companyId), ...conditions) as SQL;

export class CrossTenantError extends AuthorizationError {
  constructor() {
    super("Cross-company access denied");
    this.name = "CrossTenantError";
  }
}

/** Throws unless `row` exists and belongs to `companyId`. */
export const assertTenantOwnership = <T extends { companyId: string }>(
  row: T | null | undefined,
  companyId: string,
): T => {
  if (!row || row.companyId !== companyId) {
    throw new CrossTenantError();
  }

  return row;
};

/**
 * The company a write goes to: always the active one. A company id sent by the
 * client (a form opened in another tab before switching company) must match,
 * or the write is refused instead of landing in the wrong company.
 */
export const resolveWritableCompanyId = (
  context: { companyId: string },
  requestedCompanyId?: string | null,
): string => {
  if (requestedCompanyId && requestedCompanyId !== context.companyId) {
    throw new CrossTenantError();
  }

  return context.companyId;
};
