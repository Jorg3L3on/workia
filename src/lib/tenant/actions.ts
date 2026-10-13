"use server";

import { redirect } from "next/navigation";

import { unstable_update } from "@/auth";
import { requireAuth } from "@/lib/auth/session";
import { companyCopy } from "@/lib/brand/chrome-copy";

import { listActiveMemberships } from "./memberships";

export type SwitchCompanyState = { error?: string };

/**
 * Changes the company the session acts in. Only a company the user has an
 * active membership in is accepted; anything else leaves the session as it was.
 */
export const switchCompanyAction = async (
  _previous: SwitchCompanyState,
  formData: FormData,
): Promise<SwitchCompanyState> => {
  const session = await requireAuth();
  const companyId = String(formData.get("companyId") ?? "");
  const memberships = await listActiveMemberships(session.user.id);

  if (!memberships.some((membership) => membership.companyId === companyId)) {
    return { error: companyCopy.switchDenied };
  }

  await unstable_update({ activeCompanyId: companyId });
  redirect("/app");
};
