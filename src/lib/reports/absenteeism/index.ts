/**
 * Reportes → Ausentismo y rotación (Workia 2.0 W2-20): absenteeism and
 * turnover of the active company (one subsidiary) by región and sucursal.
 * See docs/reportes-ausentismo.md.
 */

export * from "./report";
export { getAbsenteeismReport, loadAbsenteeismDetail } from "./data";
export type { AbsenteeismFilter } from "./schema";
