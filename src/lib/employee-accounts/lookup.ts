import { sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db";

export type CredentialKind = "email" | "curp" | "session";

/**
 * The company that holds a credential (a normalized email or CURP with a live
 * account, or a live session token hash), or null. Sign-in needs it before
 * any company is known; migration 0030's SECURITY DEFINER function answers
 * only this, so everything after it reads under RLS of that company.
 */
export const credentialCompany = async (
  kind: CredentialKind,
  lookup: string,
  executor: DbExecutor = db,
): Promise<string | null> => {
  const result = await executor.execute<{ company_id: string | null }>(
    sql`select employee_credential_company(${kind}, ${lookup}) as company_id`,
  );

  return result.rows[0]?.company_id ?? null;
};
