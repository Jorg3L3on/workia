"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin } from "@/lib/employee-accounts/session";
import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { listTransferTargets } from "./access";
import { TRANSFER_COPY, TransferError, transferPerson } from "./index";
import { transferFormSchema } from "./schema";

/** What the transfer form shows after a refused submit (W2-24). */
export type TransferActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
};

/**
 * Transfers the person to another company of the group: people:transfer in
 * the active company and in the target, through the actor's own membership.
 * On success, back to the expediente with a notice.
 */
export const transferPersonAction = async (
  personId: string,
  _state: TransferActionState,
  formData: FormData,
): Promise<TransferActionState> => {
  let session;

  try {
    session = await requireCompanyContext("people:transfer");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: TRANSFER_COPY.denied };
    }

    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const parsed = transferFormSchema.safeParse({
    toCompanyId: text(formData, "toCompanyId"),
    fechaTraslado: text(formData, "fechaTraslado"),
    areaId: text(formData, "areaId"),
    positionId: text(formData, "positionId"),
    siteId: text(formData, "siteId"),
    managerId: text(formData, "managerId"),
    comentario: text(formData, "comentario"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
    };
  }

  const targets = await listTransferTargets({
    companyId,
    memberships: session.memberships,
  });
  const target = targets.find(
    (item) => item.companyId === parsed.data.toCompanyId,
  );

  if (!target) {
    return { error: TRANSFER_COPY.denied };
  }

  let result;

  try {
    result = await transferPerson(
      companyId,
      personId,
      parsed.data,
      session.user.id,
      {
        reinvite: target.canManageAccounts
          ? { origin: await requestOrigin() }
          : null,
      },
    );
  } catch (error) {
    if (error instanceof TransferError) {
      return error.field
        ? { fieldErrors: { [error.field]: error.message } }
        : { error: error.message };
    }

    throw error;
  }

  if (!result) {
    return { error: "Esa persona no existe en esta empresa." };
  }

  revalidatePath(`/app/personas/${personId}`);
  revalidatePath("/app/personas");
  revalidatePath("/app/auditoria");

  const invited = result.invitation?.sent ? "&invitacion=1" : "";
  redirect(`/app/personas/${personId}?traslado=1${invited}`);
};
