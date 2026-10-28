import { requireCompanyContext } from "@/lib/tenant/context";

/** Register a range of days taken. */
export const requireVacationsCreate = async () =>
  requireCompanyContext("vacations:create");

/** Void a record (soft). */
export const requireVacationsUpdate = async () =>
  requireCompanyContext("vacations:update");
