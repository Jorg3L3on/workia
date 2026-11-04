"use server";

import { revalidatePath } from "next/cache";

import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import {
  cancelDelegation,
  createDelegation,
  getManagerAccess,
  MANAGER_COPY,
} from "@/lib/managers";

/**
 * A manager's own actions in /mi/equipo (W2-07): name a backup, end one.
 * The account comes from the employee session, never from the form.
 */
export type DelegationActionState = { error?: string; notice?: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

export const createDelegationAction = async (
  _state: DelegationActionState,
  formData: FormData,
): Promise<DelegationActionState> => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    return { error: MANAGER_COPY.notManager };
  }

  const result = await createDelegation(access, {
    delegateAccountId: text(formData, "delegateAccountId"),
    startsOn: text(formData, "startsOn"),
    endsOn: text(formData, "endsOn"),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi/equipo");

  return { notice: "Suplente guardado." };
};

export const cancelDelegationAction = async (
  _state: DelegationActionState,
  formData: FormData,
): Promise<DelegationActionState> => {
  const context = await requireEmployeeContext();
  const result = await cancelDelegation(
    context.companyId,
    text(formData, "delegationId"),
    { accountId: context.accountId },
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi/equipo");

  return { notice: "Suplencia terminada." };
};
