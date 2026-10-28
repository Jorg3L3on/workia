"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { requireVacationsCreate, requireVacationsUpdate } from "./auth";
import { VACATION_COPY } from "./balance";
import { registerVacationRecord, voidVacationRecord } from "./index";
import type { VacationActionState } from "./types";

const revalidateVacations = (personId: string) => {
  revalidatePath("/app/personas");
  revalidatePath(`/app/personas/${personId}`);
  revalidatePath("/app/auditoria");
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const companyIdFrom = (session: { companyId: string }, formData: FormData) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    return null;
  }
};

/** Registers days taken. There is no pay-instead-of-resting field. */
export const registerVacationAction = async (
  _state: VacationActionState,
  formData: FormData,
): Promise<VacationActionState> => {
  let session: Awaited<ReturnType<typeof requireVacationsCreate>>;

  try {
    session = await requireVacationsCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: VACATION_COPY.deniedCreate };
    }

    redirect("/login");
  }

  const companyId = companyIdFrom(session, formData);

  if (!companyId) {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const personId = text(formData, "personId");
  const result = await registerVacationRecord(
    companyId,
    {
      personId,
      startDate: text(formData, "startDate"),
      endDate: text(formData, "endDate"),
      days: text(formData, "days"),
      note: text(formData, "note"),
    },
    session.user.id,
  );

  if (!result) {
    return { error: VACATION_COPY.personNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidateVacations(personId);

  return { ok: true, warning: result.warning ?? undefined };
};

/** Sets voided_at. Never deletes the row. */
export const voidVacationAction = async (
  _state: VacationActionState,
  formData: FormData,
): Promise<VacationActionState> => {
  let session: Awaited<ReturnType<typeof requireVacationsUpdate>>;

  try {
    session = await requireVacationsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: VACATION_COPY.deniedVoid };
    }

    redirect("/login");
  }

  const companyId = companyIdFrom(session, formData);

  if (!companyId) {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const result = await voidVacationRecord(
    companyId,
    text(formData, "recordId"),
    session.user.id,
  );

  if (!result) {
    return { error: VACATION_COPY.notFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidateVacations(text(formData, "personId"));

  return { ok: true };
};
