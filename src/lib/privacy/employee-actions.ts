"use server";

import { revalidatePath } from "next/cache";

import { requireEmployeeContext } from "@/lib/employee-accounts/session";

import { recordPrivacyAcceptance } from "./index";

/**
 * The employee accepts the privacy notice in force from the app (W2-09
 * hook, used by W2-04 before the first upload). The person comes from the
 * session; the form only names the version the person read.
 */
export const acceptPrivacyNoticeFromAppAction = async (
  _state: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> => {
  const context = await requireEmployeeContext();
  const noticeId = String(formData.get("noticeId") ?? "");
  const result = await recordPrivacyAcceptance(context.companyId, {
    personId: context.personId,
    noticeId,
    channel: "employee_app",
  }).catch(() => null);

  if (!result) {
    return { error: "No se pudo registrar tu aceptación. Intenta de nuevo." };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/mi", "layout");
  return {};
};
