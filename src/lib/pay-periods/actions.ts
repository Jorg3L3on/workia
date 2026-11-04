"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isoToday } from "@/lib/format/date";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { requirePayPeriodsManage } from "./auth";
import { PAY_PERIOD_COPY, type PayPeriodActionState } from "./copy";
import {
  closePayPeriod,
  isQuincena,
  PayPeriodError,
  quincenaRange,
  reopenPayPeriod,
} from "./index";

/**
 * Close and reopen a quincena from the HR screen (Workia 2.0 W2-15). Both
 * need pay_periods:manage; the work, the snapshot and the audit event are in
 * src/lib/pay-periods (one transaction each).
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const manageSession = async () => {
  try {
    return { session: await requirePayPeriodsManage() };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: PAY_PERIOD_COPY.denied };
    }

    redirect("/login");
  }
};

const companyIdFrom = (session: { companyId: string }, formData: FormData) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    return null;
  }
};

const revalidatePeriod = (period: string) => {
  revalidatePath("/app/periodos");
  revalidatePath(`/app/periodos/${period}`);
  revalidatePath("/app/auditoria");
};

const failure = (error: unknown): PayPeriodActionState => {
  if (error instanceof PayPeriodError) {
    return { error: error.message };
  }

  throw error;
};

export const closePayPeriodAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manageSession();

  if (!auth.session) {
    return { error: auth.error };
  }

  const companyId = companyIdFrom(auth.session, formData);

  if (!companyId) {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const period = text(formData, "period");

  if (!isQuincena(period)) {
    return { error: PAY_PERIOD_COPY.invalidPeriod };
  }

  // A quincena that has not started has nothing to freeze yet.
  if (quincenaRange(period).from > isoToday()) {
    return { error: PAY_PERIOD_COPY.notStarted };
  }

  try {
    const result = await closePayPeriod(companyId, period, {
      actorUserId: auth.session.user.id,
    });

    revalidatePeriod(period);

    return {
      ok: true,
      message: PAY_PERIOD_COPY.closedMessage(
        result.period.revision,
        result.snapshotRows,
      ),
    };
  } catch (error) {
    return failure(error);
  }
};

export const reopenPayPeriodAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manageSession();

  if (!auth.session) {
    return { error: auth.error };
  }

  const companyId = companyIdFrom(auth.session, formData);

  if (!companyId) {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const period = text(formData, "period");

  if (!isQuincena(period)) {
    return { error: PAY_PERIOD_COPY.invalidPeriod };
  }

  try {
    await reopenPayPeriod(companyId, period, {
      reason: text(formData, "reason"),
      actorUserId: auth.session.user.id,
    });

    revalidatePeriod(period);

    return { ok: true, message: PAY_PERIOD_COPY.reopened };
  } catch (error) {
    return failure(error);
  }
};
