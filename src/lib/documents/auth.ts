import { requireCompanyContext } from "@/lib/tenant/context";

/** See requirements and delivery dates. */
export const requireDocumentsRead = async () =>
  requireCompanyContext("documents:read");

/** Define requirements and record a delivery date. */
export const requireDocumentsManage = async () =>
  requireCompanyContext("documents:manage");
