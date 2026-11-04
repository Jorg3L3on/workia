"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PayPeriodActionState } from "@/lib/pay-periods/copy";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { requirePrenominaManage } from "./auth";
import { PRENOMINA_COPY } from "./copy";
import {
  archivePrenominaTemplate,
  createPrenominaTemplate,
  PrenominaError,
  updatePrenominaTemplate,
} from "./index";
import type { PrenominaTemplateInput } from "./template";

/**
 * Pre-nómina templates from the HR screen (W2-18), with pay_periods:manage.
 * The template comes as JSON in the "template" field and is validated by
 * src/lib/prenomina/template.ts; an "id" edits that template.
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const manageSession = async () => {
  try {
    return { session: await requirePrenominaManage() };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: PRENOMINA_COPY.denied };
    }

    redirect("/login");
  }
};

const companyIdFrom = (session: { companyId: string }, formData: FormData) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    return null;
  }
};

const revalidate = () => {
  revalidatePath("/app/periodos/plantillas");
  revalidatePath("/app/auditoria");
};

export const savePrenominaTemplateAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState & { id?: string }> => {
  const auth = await manageSession();

  if (!auth.session) return { error: auth.error };

  const companyId = companyIdFrom(auth.session, formData);

  if (!companyId) return { error: STALE_COMPANY_MESSAGE };

  let input: PrenominaTemplateInput;

  try {
    input = JSON.parse(text(formData, "template")) as PrenominaTemplateInput;
  } catch {
    return { error: PRENOMINA_COPY.invalid };
  }

  const id = text(formData, "id");
  const options = { actorUserId: auth.session.user.id };

  try {
    const saved = id
      ? await updatePrenominaTemplate(companyId, id, input, options)
      : await createPrenominaTemplate(companyId, input, options);

    if (!saved) return { error: PRENOMINA_COPY.notFound };

    revalidate();

    return { ok: true, message: PRENOMINA_COPY.saved, id: saved.id };
  } catch (error) {
    if (error instanceof PrenominaError) return { error: error.message };
    throw error;
  }
};

export const archivePrenominaTemplateAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manageSession();

  if (!auth.session) return { error: auth.error };

  const companyId = companyIdFrom(auth.session, formData);

  if (!companyId) return { error: STALE_COMPANY_MESSAGE };

  const archived = await archivePrenominaTemplate(
    companyId,
    text(formData, "id"),
    { actorUserId: auth.session.user.id },
  );

  if (!archived) return { error: PRENOMINA_COPY.notFound };

  revalidate();

  return { ok: true, message: PRENOMINA_COPY.archived };
};
