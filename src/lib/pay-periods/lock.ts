import { and, eq } from "drizzle-orm";

import type { DbTransaction } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";

import { PayPeriodError, quincenaLabel, quincenaRange } from "./quincena";

/**
 * Holds a pay period open for the rest of the caller's transaction (Workia
 * 2.0 W2-15): creates its row if nobody has closed it yet, takes a FOR SHARE
 * lock on it and refuses a closed period. closePayPeriod locks the same row
 * FOR UPDATE, so a close waits for every engine write of the period in
 * flight, and an engine write that starts after a close sees it closed. The
 * snapshot a close takes therefore always holds the last engine output.
 *
 * FOR SHARE needs the UPDATE privilege, which workia_app has on pay_periods
 * (0035) but not on person_events, so the lock lives here and not on the
 * events.
 */
export const lockOpenPayPeriod = async (
  tx: DbTransaction,
  companyId: string,
  period: string,
) => {
  const range = quincenaRange(period);

  await tx
    .insert(payPeriods)
    .values({ companyId, period, startsOn: range.from, endsOn: range.to })
    .onConflictDoNothing({
      target: [payPeriods.companyId, payPeriods.period],
    });

  const [current] = await tx
    .select({ id: payPeriods.id, status: payPeriods.status })
    .from(payPeriods)
    .where(
      and(eq(payPeriods.companyId, companyId), eq(payPeriods.period, period)),
    )
    .for("share");

  if (!current || current.status === "closed") {
    throw new PayPeriodError(
      "period_closed",
      `La ${quincenaLabel(period)} está cerrada. Reábrela para cambiar sus incidencias.`,
    );
  }

  return { id: current.id, range };
};
