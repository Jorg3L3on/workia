/**
 * Reportes → Grupo (Workia 2.0 W2-25): headcount, turnover and absenteeism of
 * every subsidiary the reader may see, by company, región and sucursal. See
 * docs/reportes-grupo.md.
 */

export * from "./report";
export {
  companiesInView,
  getGroupDashboard,
  loadCompanyTransfers,
  loadGroupReportReader,
  type GroupReportReader,
} from "./data";
export type { GroupFilter } from "./schema";
