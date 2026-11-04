"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import {
  cancelProfileCorrection,
  requestProfileCorrection,
} from "@/lib/profile-corrections";

/**
 * Mi expediente corrections from /mi (Workia 2.0 W2-02). The person is the
 * session's, never a field of the form: a request or a cancel always lands
 * on the signed-in employee's own record.
 */
export type CorrectionFormState = {
  error?: string;
  proposedValue?: string;
  note?: string;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
};

export const requestProfileCorrectionAction = async (
  _state: CorrectionFormState,
  formData: FormData,
): Promise<CorrectionFormState> => {
  const context = await requireEmployeeContext();
  const proposedValue = text(formData, "proposedValue");
  const note = text(formData, "note");
  const result = await requestProfileCorrection(context, {
    field: text(formData, "field"),
    proposedValue,
    note,
  });

  if (!result.ok) {
    return { error: result.error, proposedValue, note };
  }

  revalidatePath("/mi/expediente");
  revalidatePath("/app/correcciones");
  redirect("/mi/expediente?enviada=1#mis-correcciones");
};

export const cancelProfileCorrectionAction = async (formData: FormData) => {
  const context = await requireEmployeeContext();

  await cancelProfileCorrection(context, text(formData, "id"));
  revalidatePath("/mi/expediente");
  revalidatePath("/app/correcciones");
  redirect("/mi/expediente#mis-correcciones");
};
