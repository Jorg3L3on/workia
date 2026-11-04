"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePeopleUpdate } from "@/lib/people/auth";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { decideProfileCorrection, PROFILE_CORRECTION_COPY } from "./index";

/**
 * HR closes a Mi expediente correction from /app/correcciones (Workia 2.0
 * W2-02). people:update, the permission that edits the record it corrects.
 */
export type DecideCorrectionState = { error?: string; done?: boolean };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
};

export const decideProfileCorrectionAction = async (
  _state: DecideCorrectionState,
  formData: FormData,
): Promise<DecideCorrectionState> => {
  let session: Awaited<ReturnType<typeof requirePeopleUpdate>>;

  try {
    session = await requirePeopleUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: PROFILE_CORRECTION_COPY.denied };
    }

    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const decision = text(formData, "decision");

  if (decision !== "aplicada" && decision !== "rechazada") {
    return { error: PROFILE_CORRECTION_COPY.notFound };
  }

  const result = await decideProfileCorrection(
    companyId,
    { id: text(formData, "id"), decision, reason: text(formData, "reason") },
    session.user.id,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/app/correcciones");
  revalidatePath("/mi/expediente");

  return { done: true };
};
