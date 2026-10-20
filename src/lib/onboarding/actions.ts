"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCompanyContext } from "@/lib/tenant/context";
import { userHasPermission } from "@/lib/rbac";
import { AuthorizationError } from "@/lib/rbac/errors";
import { writableCompanyIdFromForm } from "@/lib/tenant/scope";

import {
  approveOnboardingStep,
  getOnboardingById,
  OnboardingError,
  rejectOnboarding,
  startOnboarding,
  updateOnboarding,
} from "./index";
import { ONBOARDING_CHECKLIST, onboardingFormSchema } from "./schema";

const ALTAS = "/app/altas";

const revalidateAltas = (id?: string) => {
  revalidatePath(ALTAS);
  revalidatePath("/app/auditoria");
  if (id) revalidatePath(`${ALTAS}/${id}`);
};

// Typed on the binding so TypeScript narrows after a call (it never returns).
const back: (path: string, query: Record<string, string>) => never = (
  path,
  query,
) => redirect(`${path}?${new URLSearchParams(query)}`);

/** HR's door to altas: people:update in the active company. */
const requireHr = async (path: string) => {
  try {
    return await requireCompanyContext("people:update");
  } catch (error) {
    if (error instanceof AuthorizationError)
      back(path, { error: "permission" });
    redirect("/login");
  }
};

const companyOrBack = (
  session: { companyId: string },
  formData: FormData,
  path: string,
) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    back(path, { error: "company-changed" });
  }
};

const captureFromForm = (formData: FormData) =>
  onboardingFormSchema.safeParse({
    checklist: Object.fromEntries(
      ONBOARDING_CHECKLIST.map((item) => [
        item,
        formData.get(`checklist_${item}`) === "on",
      ]),
    ),
    infonavitCredito: String(formData.get("infonavitCredito") ?? ""),
    infonavitTipoDescuento: String(
      formData.get("infonavitTipoDescuento") ?? "",
    ),
    infonavitFactor: String(formData.get("infonavitFactor") ?? ""),
    fonacotCredito: String(formData.get("fonacotCredito") ?? ""),
    fonacotDescuento: String(formData.get("fonacotDescuento") ?? ""),
  });

const failWith = (path: string) => (error: unknown) => {
  if (error instanceof OnboardingError) {
    back(path, { error: "domain", message: error.message });
  }

  throw error;
};

export const startOnboardingAction = async (formData: FormData) => {
  const session = await requireHr(ALTAS);
  const companyId = companyOrBack(session, formData, ALTAS);
  const personId = String(formData.get("personId") ?? "");

  if (!personId) back(ALTAS, { error: "person" });

  const created = await startOnboarding(
    companyId,
    personId,
    session.user.id,
  ).catch(failWith(ALTAS));
  revalidateAltas(created.id);
  redirect(`${ALTAS}/${created.id}?started=1`);
};

/**
 * Saves the checklist and Infonavit/Fonacot: HR, or Payroll in its stage.
 * The detail autosaves (WRK-I6-4), so success returns instead of redirecting;
 * failures still go back to the page with the error.
 */
export const updateOnboardingAction = async (
  id: string,
  formData: FormData,
): Promise<{ saved: true }> => {
  const path = `${ALTAS}/${id}`;
  let session;

  try {
    session = await requireCompanyContext("people:read");
  } catch (error) {
    if (error instanceof AuthorizationError)
      back(path, { error: "permission" });
    redirect("/login");
  }

  const companyId = companyOrBack(session, formData, path);
  const row = await getOnboardingById(companyId, id);

  if (!row) back(ALTAS, { error: "not-found" });

  const permission =
    row.onboarding.stage === "pendiente_nominas"
      ? "payroll:approve"
      : "people:update";

  if (!(await userHasPermission(session.user.id, permission))) {
    back(path, { error: "permission" });
  }

  const parsed = captureFromForm(formData);

  if (!parsed.success) {
    back(path, {
      error: "domain",
      message: parsed.error.issues[0]?.message ?? "Revisa la captura.",
    });
  }

  await updateOnboarding(companyId, id, parsed.data, session.user.id).catch(
    failWith(path),
  );
  revalidateAltas(id);
  return { saved: true };
};

/** HR approves with people:update; Payroll with payroll:approve. */
export const approveOnboardingAction = async (
  id: string,
  formData: FormData,
) => {
  const path = `${ALTAS}/${id}`;
  let session;

  try {
    session = await requireCompanyContext("people:read");
  } catch (error) {
    if (error instanceof AuthorizationError)
      back(path, { error: "permission" });
    redirect("/login");
  }

  const companyId = companyOrBack(session, formData, path);
  const row = await getOnboardingById(companyId, id);

  if (!row) back(ALTAS, { error: "not-found" });

  const permission =
    row.onboarding.stage === "pendiente_nominas"
      ? "payroll:approve"
      : "people:update";

  if (!(await userHasPermission(session.user.id, permission))) {
    back(path, { error: "permission" });
  }

  await approveOnboardingStep(companyId, id, session.user.id).catch(
    failWith(path),
  );
  revalidateAltas(id);
  back(path, { approved: "1" });
};

export const rejectOnboardingAction = async (
  id: string,
  formData: FormData,
) => {
  const path = `${ALTAS}/${id}`;
  let session;

  try {
    session = await requireCompanyContext("payroll:approve");
  } catch (error) {
    if (error instanceof AuthorizationError)
      back(path, { error: "permission" });
    redirect("/login");
  }

  const companyId = companyOrBack(session, formData, path);

  await rejectOnboarding(
    companyId,
    id,
    String(formData.get("motivo") ?? ""),
    session.user.id,
  ).catch(failWith(path));
  revalidateAltas(id);
  back(path, { rejected: "1" });
};
