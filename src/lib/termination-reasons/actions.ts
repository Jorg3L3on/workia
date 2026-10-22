"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import { writableCompanyIdFromForm } from "@/lib/tenant/scope";

import { requireTerminationReasonsManage } from "./auth";
import {
  createTerminationReason,
  softDeleteTerminationReason,
  TerminationReasonInUseError,
  updateTerminationReason,
} from "./index";
import { terminationReasonFormSchema } from "./schema";

const revalidateReasons = () => {
  revalidatePath(CATALOG_PATHS.motivosBaja);
  revalidatePath("/app/auditoria");
  revalidatePath("/app/personas");
};

// Typed on the binding so TypeScript narrows after a call (it never returns).
const back: (query: Record<string, string>) => never = (query) =>
  redirect(catalogHref(CATALOG_PATHS.motivosBaja, query));

const parseReasonForm = (formData: FormData) =>
  terminationReasonFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    active:
      formData.get("active") === null
        ? true
        : formData.get("active") === "on" || formData.get("active") === "true",
  });

const onDuplicate = (error: unknown) => {
  if (error instanceof DuplicateNameError) {
    back({ error: "duplicate-name" });
  }

  throw error;
};

const requireManage = async () => {
  try {
    return await requireTerminationReasonsManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      back({ error: "termination-reasons-forbidden" });
    }
    redirect("/login");
  }
};

export const createTerminationReasonAction = async (formData: FormData) => {
  const session = await requireManage();
  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    back({ error: "company-changed" });
  }

  const parsed = parseReasonForm(formData);

  if (!parsed.success) {
    back({ error: "termination-reason-form" });
  }

  await createTerminationReason(companyId, parsed.data, session.user.id).catch(
    onDuplicate,
  );
  revalidateReasons();
  back({ saved: "termination-reason" });
};

export const updateTerminationReasonAction = async (
  reasonId: string,
  formData: FormData,
) => {
  const session = await requireManage();
  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    back({ error: "company-changed" });
  }

  const parsed = parseReasonForm(formData);

  if (!parsed.success) {
    back({ error: "termination-reason-form" });
  }

  const updated = await updateTerminationReason(
    companyId,
    reasonId,
    parsed.data,
    session.user.id,
  ).catch(onDuplicate);

  if (!updated) {
    back({ error: "not-found" });
  }

  revalidateReasons();
  back({ saved: "termination-reason" });
};

export const deleteTerminationReasonAction = async (reasonId: string) => {
  const session = await requireManage();
  let deleted;

  try {
    deleted = await softDeleteTerminationReason(
      session.companyId,
      reasonId,
      session.user.id,
    );
  } catch (error) {
    if (error instanceof TerminationReasonInUseError) {
      back({ error: "termination-reason-in-use" });
    }
    throw error;
  }

  if (!deleted) {
    back({ error: "not-found" });
  }

  revalidateReasons();
  back({ deleted: "termination-reason" });
};
