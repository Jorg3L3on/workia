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
  disableEmployeeAccount,
  EMPLOYEE_ACCOUNT_COPY,
  inviteEmployee,
  issueActivationCode,
} from "./index";
import { requestOrigin } from "./session";

/** What the expediente card shows after an HR action (W2-01). */
export type EmployeeAccountActionState = {
  error?: string;
  notice?: string;
  /** The activation code, shown once; never stored in clear. */
  code?: string;
  codeExpiresAt?: string;
};

const requireManage = async () => {
  try {
    return await requireCompanyContext("employee_accounts:manage");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: EMPLOYEE_ACCOUNT_COPY.denied } as const;
    }

    redirect("/login");
  }
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

/** The HR session and the company the form was opened in, or the error to show. */
const context = async (formData: FormData) => {
  const session = await requireManage();

  if ("error" in session) {
    return { error: session.error } as const;
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

export const inviteEmployeeAction = async (
  _state: EmployeeAccountActionState,
  formData: FormData,
): Promise<EmployeeAccountActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await inviteEmployee(
    companyId,
    personId,
    text(formData, "email"),
    session.user.id,
    { origin: await requestOrigin() },
  );

  if (!result) {
    return { error: EMPLOYEE_ACCOUNT_COPY.personNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidate(personId);

  return result.emailSent
    ? { notice: `Invitación enviada a ${result.email}.` }
    : { error: EMPLOYEE_ACCOUNT_COPY.emailNotSent };
};

export const issueActivationCodeAction = async (
  _state: EmployeeAccountActionState,
  formData: FormData,
): Promise<EmployeeAccountActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await issueActivationCode(
    companyId,
    personId,
    session.user.id,
  );

  if (!result) {
    return { error: EMPLOYEE_ACCOUNT_COPY.personNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidate(personId);

  return { code: result.code, codeExpiresAt: result.expiresAt.toISOString() };
};

export const disableEmployeeAccountAction = async (
  _state: EmployeeAccountActionState,
  formData: FormData,
): Promise<EmployeeAccountActionState> => {
  const resolved = await context(formData);

  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const { session, companyId, personId } = resolved;
  const result = await disableEmployeeAccount(
    companyId,
    personId,
    session.user.id,
  );

  if (!result) {
    return { error: EMPLOYEE_ACCOUNT_COPY.noAccount };
  }

  revalidate(personId);

  return { notice: "Cuenta desactivada. Sus sesiones se cerraron." };
};
