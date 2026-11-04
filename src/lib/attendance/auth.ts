import { requireCompanyContext } from "@/lib/tenant/context";

/** See uploads, the unmatched report, checadores and check-in points. */
export const requireAttendanceRead = async () =>
  requireCompanyContext("attendance:read");

/** Upload exports, configure checadores and tokens, assign numbers, set up check-in. */
export const requireAttendanceManage = async () =>
  requireCompanyContext("attendance:manage");
