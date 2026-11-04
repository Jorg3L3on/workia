"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import {
  decidedHref,
  decideRequestAsHr,
  HR_DECIDE_PERMISSION,
  REQUEST_COPY,
} from "./index";

/** What HR's decision form shows after it is sent (W2-06). */
export type HrRequestActionState = { error?: string; notice?: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

/**
 * HR approves or rejects a request from /app/solicitudes, in the company the
 * form was opened in. vacations:update: an approval writes vacation days.
 */
export const decideRequestByHrAction = async (
  _state: HrRequestActionState,
  formData: FormData,
): Promise<HrRequestActionState> => {
  let session: Awaited<ReturnType<typeof requireCompanyContext>>;

  try {
    session = await requireCompanyContext(HR_DECIDE_PERMISSION);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: REQUEST_COPY.deniedDecide };
    }

    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const requestId = text(formData, "requestId");
  const result = await decideRequestAsHr(
    companyId,
    requestId,
    { decision: text(formData, "decision"), reason: text(formData, "reason") },
    session.user.id,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/app/solicitudes");
  revalidatePath(`/app/solicitudes/${requestId}`);
  redirect(decidedHref("/app/solicitudes", formData, result.warning));
};
