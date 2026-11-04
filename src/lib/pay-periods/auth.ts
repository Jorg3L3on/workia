import { requireCompanyContext } from "@/lib/tenant/context";

/** The quincenas and their incidencias (W2-15): admin by default. */
export const requirePayPeriodsRead = async () =>
  requireCompanyContext("pay_periods:read");

/** Close and reopen a quincena. */
export const requirePayPeriodsManage = async () =>
  requireCompanyContext("pay_periods:manage");
