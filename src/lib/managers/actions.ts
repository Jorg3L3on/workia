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
  cancelDelegation,
  MANAGER_COPY,
  revokeManagerGrant,
  setManagerGrant,
} from "./index";

/** What «Rol de jefe» on the expediente shows after an HR action (W2-07). */
export type ManagerAdminActionState = { error?: string; notice?: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

/** HR with employee_accounts:manage, in the company the form was opened in. */
const context = async (formData: FormData) => {
  let session: Awaited<ReturnType<typeof requireCompanyContext>>;

  try {
    session = await requireCompanyContext("employee_accounts:manage");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: MANAGER_COPY.denied } as const;
    }

    redirect("/login");
  }

  try {
    return {
      session,
      companyId: writableCompanyIdFromForm(session, formData),
      personId: text(formData, "personId"),
    } as const;
  } catch {
    return { error: STALE_COMPANY_MESSAGE } as const;
  }
};

const revalidate = (personId: string) => {
  revalidatePath(`/app/personas/${personId}`);
  revalidatePath("/app/auditoria");
};

export const setManagerGrantAction = async (
  _state: ManagerAdminActionState,
  formData: FormData,
): Promise<ManagerAdminActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await setManagerGrant(
    companyId,
    personId,
    formData.get("includeIndirect") === "on",
    session.user.id,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidate(personId);

  return { notice: "Rol de jefe guardado." };
};

export const revokeManagerGrantAction = async (
  _state: ManagerAdminActionState,
  formData: FormData,
): Promise<ManagerAdminActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await revokeManagerGrant(companyId, personId, session.user.id);

  if (!result.ok) {
    return { error: result.error };
  }

  revalidate(personId);

  return { notice: "Rol de jefe retirado. Sus suplencias terminaron." };
};

export const cancelDelegationByHrAction = async (
  _state: ManagerAdminActionState,
  formData: FormData,
): Promise<ManagerAdminActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await cancelDelegation(
    companyId,
    text(formData, "delegationId"),
    { userId: session.user.id },
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidate(personId);

  return { notice: "Suplencia terminada." };
};
