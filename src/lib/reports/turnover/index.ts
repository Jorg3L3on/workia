/**
 * Reportes → Rotación (WRK-I12): the turnover report of the active company.
 * loadTurnoverFacts() reads the periods once and buildTurnoverReport()
 * (./report, pure) computes everything from them.
 */

import { isoToday } from "@/lib/format/date";
import { countUnclassifiedTerminationReasons } from "@/lib/termination-reasons";

import { getTurnoverGoal, loadTurnoverFacts, loadTurnoverLabels } from "./data";
import { buildTurnoverReport } from "./report";
import type { TurnoverFilter } from "./schema";

export * from "./report";
export type { TurnoverFilter } from "./schema";

export const getTurnoverReport = async (
  companyId: string,
  filter: TurnoverFilter,
  options: { withDetail?: boolean; today?: string } = {},
) => {
  const [facts, labels, goal, unclassifiedReasons] = await Promise.all([
    loadTurnoverFacts(companyId),
    loadTurnoverLabels(companyId),
    getTurnoverGoal(companyId),
    countUnclassifiedTerminationReasons(companyId),
  ]);

  return {
    report: buildTurnoverReport(facts, filter, {
      labels,
      goal,
      today: options.today ?? isoToday(),
      unclassifiedReasons,
      withDetail: Boolean(options.withDetail),
    }),
    labels,
  };
};
