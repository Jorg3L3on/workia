"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createContract,
  createContractTemplate,
  deactivateContractTemplate,
  markContractNoRenew,
  renewContract,
  softDeleteContractTemplate,
  updateContractTemplate,
} from "@/lib/contracts";
import {
  requireContractsCreate,
  requireContractsUpdate,
  requireContractTemplatesCreate,
  requireContractTemplatesDelete,
  requireContractTemplatesUpdate,
} from "@/lib/contracts/auth";
import {
  contractFormSchema,
  contractTemplateFormSchema,
  renewContractFormSchema,
} from "@/lib/contracts/schema";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

const revalidateContracts = (personId?: string) => {
  revalidatePath("/app");
  revalidatePath("/app/contratos");
  revalidatePath("/app/contratos/plantillas");
  revalidatePath("/app/auditoria");

  if (personId) {
    revalidatePath(`/app/personas/${personId}`);
  }
};

export type ContractActionState = {
  error?: string;
  success?: boolean;
};

const parseContractForm = (formData: FormData) =>
  contractFormSchema.safeParse({
    personId: String(formData.get("personId") ?? ""),
    type: String(formData.get("type") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    noticeWindow: String(formData.get("noticeWindow") ?? ""),
    templateId: String(formData.get("templateId") ?? ""),
  });

const parseRenewForm = (formData: FormData) =>
  renewContractFormSchema.safeParse({
    contractId: String(formData.get("contractId") ?? ""),
    type: String(formData.get("type") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    noticeWindow: String(formData.get("noticeWindow") ?? ""),
    templateId: String(formData.get("templateId") ?? ""),
  });

const parseTemplateForm = (formData: FormData) =>
  contractTemplateFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    body: String(formData.get("body") ?? ""),
    active:
      formData.get("active") === "on" || formData.get("active") === "true",
  });

/** The active company, or back to the templates when the form was opened in another company. */
const templateCompanyOrRedirect = (
  session: { companyId: string },
  formData: FormData,
) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    redirect("/app/contratos/plantillas?error=company-changed");
  }
};

export const createContractAction = async (
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> => {
  let session;

  try {
    session = await requireContractsCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para emitir contratos." };
    }

    redirect("/login");
  }

  const parsed = parseContractForm(formData);

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Revisa los datos del contrato.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const created = await createContract(companyId, parsed.data, session.user.id);
  revalidateContracts(created.personId);
  redirect(`/app/personas/${created.personId}?contract=created`);
};

export const renewContractAction = async (
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> => {
  let session;

  try {
    session = await requireContractsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para renovar contratos." };
    }

    redirect("/login");
  }

  const parsed = parseRenewForm(formData);

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Revisa los datos de renovación.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const renewed = await renewContract(companyId, parsed.data, session.user.id);
  revalidateContracts(renewed.personId);
  redirect(`/app/contratos?renewed=1`);
};

export const noRenewContractAction = async (contractId: string) => {
  let session;

  try {
    session = await requireContractsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/contratos?error=no-renew-permission");
    }

    redirect("/login");
  }

  const updated = await markContractNoRenew(
    session.companyId,
    contractId,
    session.user.id,
  );
  revalidateContracts(updated.personId);
  redirect("/app/contratos?no-renew=1");
};

export const createContractTemplateAction = async (formData: FormData) => {
  let session;

  try {
    session = await requireContractTemplatesCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/contratos/plantillas?error=create-permission");
    }

    redirect("/login");
  }

  const parsed = parseTemplateForm(formData);

  if (!parsed.success) {
    redirect("/app/contratos/plantillas?error=form");
  }

  const companyId = templateCompanyOrRedirect(session, formData);

  await createContractTemplate(companyId, parsed.data, session.user.id);
  revalidateContracts();
  redirect("/app/contratos/plantillas?saved=1");
};

export const updateContractTemplateAction = async (
  templateId: string,
  formData: FormData,
) => {
  let session;

  try {
    session = await requireContractTemplatesUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        `/app/contratos/plantillas/${templateId}?error=update-permission`,
      );
    }

    redirect("/login");
  }

  const parsed = parseTemplateForm(formData);

  if (!parsed.success) {
    redirect(`/app/contratos/plantillas/${templateId}?error=form`);
  }

  const companyId = templateCompanyOrRedirect(session, formData);

  await updateContractTemplate(
    companyId,
    templateId,
    parsed.data,
    session.user.id,
  );
  revalidateContracts();
  redirect(`/app/contratos/plantillas/${templateId}?saved=1`);
};

export const deactivateContractTemplateAction = async (templateId: string) => {
  let session;

  try {
    session = await requireContractTemplatesDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/contratos/plantillas?error=deactivate-permission");
    }

    redirect("/login");
  }

  await deactivateContractTemplate(
    session.companyId,
    templateId,
    session.user.id,
  );
  revalidateContracts();
  redirect("/app/contratos/plantillas?deactivated=1");
};

export const deleteContractTemplateAction = async (templateId: string) => {
  let session;

  try {
    session = await requireContractTemplatesDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/contratos/plantillas?error=delete-permission");
    }

    redirect("/login");
  }

  await softDeleteContractTemplate(
    session.companyId,
    templateId,
    session.user.id,
  );
  revalidateContracts();
  redirect("/app/contratos/plantillas?deleted=1");
};
