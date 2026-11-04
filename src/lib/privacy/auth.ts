import { requireCompanyContext } from "@/lib/tenant/context";

/** See the notice versions, ARCO requests, retention and the access log. */
export const requirePrivacyRead = async () =>
  requireCompanyContext("privacy:read");

/** Publish a notice, register and close ARCO requests, download an export. */
export const requirePrivacyManage = async () =>
  requireCompanyContext("privacy:manage");
