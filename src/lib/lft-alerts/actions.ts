"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PayPeriodActionState } from "@/lib/pay-periods/copy";
import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { LFT_ALERTS_COPY } from "./copy";
import { LFT_ALERT_PERMISSIONS, runLftAlerts } from "./index";

/**
 * «Revisar ahora» on /app/alertas (W2-19): runs every LFT check in the active
 * company. It needs one of the permissions that receive an alert; the alerts
 * still go to whoever holds each check's permission, never to the form.
 */
export const runLftAlertsNowAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  let session;

  try {
    session = await requireCompanyContext();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: LFT_ALERTS_COPY.forbidden };
    }

    redirect("/login");
  }

  const allowed = Object.values(LFT_ALERT_PERMISSIONS).some(({ notify }) =>
    session.permissions.has(notify),
  );

  if (!allowed) return { error: LFT_ALERTS_COPY.forbidden };

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const result = await runLftAlerts(companyId);

  revalidatePath("/app/alertas");
  revalidatePath("/app/avisos");

  return { ok: true, message: LFT_ALERTS_COPY.ran(result.sent) };
};
