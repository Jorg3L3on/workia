"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { getManagerAccess } from "@/lib/managers";
import {
  cancelTimeOffRequest,
  createTimeOffRequest,
  decidedHref,
  decideRequestAsManager,
  REQUEST_COPY,
} from "@/lib/requests";

/**
 * The employee's and the manager's request actions in /mi (W2-06). The
 * person and the account come from the employee session, never from the
 * form; the form only says what is asked or decided.
 */
export type RequestActionState = { error?: string; notice?: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

/** «Pedir vacaciones o permiso». On success it goes back to the list. */
export const createRequestAction = async (
  _state: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> => {
  const context = await requireEmployeeContext();
  const result = await createTimeOffRequest(context, {
    kind: text(formData, "kind"),
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    days: text(formData, "days"),
    note: text(formData, "note"),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi/solicitudes");
  redirect("/mi/solicitudes?enviada=1");
};

export const cancelRequestAction = async (
  _state: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> => {
  const context = await requireEmployeeContext();
  const result = await cancelTimeOffRequest(
    context,
    text(formData, "requestId"),
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi/solicitudes");

  return { notice: "Solicitud cancelada." };
};

/** A manager (or their backup) approves or rejects from the inbox, then goes back to it. */
export const decideRequestAction = async (
  _state: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    return { error: REQUEST_COPY.notFound };
  }

  const requestId = text(formData, "requestId");
  const result = await decideRequestAsManager(access, requestId, {
    decision: text(formData, "decision"),
    reason: text(formData, "reason"),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi/equipo/aprobaciones");
  revalidatePath(`/mi/equipo/aprobaciones/${requestId}`);
  // Back to the inbox, which says what was decided.
  redirect(decidedHref("/mi/equipo/aprobaciones", formData, result.warning));
};
