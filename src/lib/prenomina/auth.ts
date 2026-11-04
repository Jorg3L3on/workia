import { requireCompanyContext } from "@/lib/tenant/context";

/** See the pre-nómina summary and the templates: as the quincenas. */
export const requirePrenominaRead = async () =>
  requireCompanyContext("pay_periods:read");

/** Create, change and archive templates: as closing a quincena. */
export const requirePrenominaManage = async () =>
  requireCompanyContext("pay_periods:manage");
