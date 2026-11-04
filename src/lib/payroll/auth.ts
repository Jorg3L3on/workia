import { requireCompanyContext } from "@/lib/tenant/context";

/** See the periods, who opened their receipt, and download a receipt. */
export const requirePayrollRead = async () =>
  requireCompanyContext("payroll_receipts:read");

/** Import, match unmatched receipts, publish and discard a period. */
export const requirePayrollManage = async () =>
  requireCompanyContext("payroll_receipts:manage");
