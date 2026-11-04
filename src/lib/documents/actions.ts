"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { CATALOG_PATHS } from "@/lib/catalog/paths";

import { requireDocumentsManage } from "./auth";
import { reviewDocument } from "./files";
import { DOCUMENT_FILES_COPY, reviewDocumentSchema } from "./files-schema";
import { recordDelivery, setRequirements } from "./index";
import {
  expiresOnFromForm,
  recordDeliverySchema,
  setRequirementsSchema,
} from "./schema";

const DENIED = "No tienes permiso para gestionar documentos.";

const revalidateDocuments = () => {
  revalidatePath("/app/documentos/revision");
  revalidatePath("/app/personas");
  revalidatePath("/app/auditoria");
  revalidatePath(CATALOG_PATHS.puestos);
};

const requireManage = async () => {
  try {
    return await requireDocumentsManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: DENIED } as const;
    }

    redirect("/login");
  }
};

export const setRequirementsAction = async (formData: FormData) => {
  const session = await requireManage();

  if ("error" in session) {
    return session;
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Revisa los requisitos." };
  }

  const parsed = setRequirementsSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revisa los requisitos.",
    };
  }

  try {
    const saved = await setRequirements(
      companyId,
      parsed.data,
      session.user.id,
    );

    if (!saved) {
      return { error: "No encontramos ese registro en esta empresa." };
    }
  } catch (error) {
    if (error instanceof DuplicateNameError) {
      return { error: error.message };
    }

    throw error;
  }

  revalidateDocuments();
  return { ok: true as const };
};

/**
 * Records a delivery. A missing or blank expiresOn is not sent, so the
 * domain computes it from validity_months. The checkbox noVence (on, true
 * or 1) is the explicit «does not expire» and stores null instead.
 */
export const recordDeliveryAction = async (formData: FormData) => {
  const session = await requireManage();

  if ("error" in session) {
    return session;
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const parsed = recordDeliverySchema.safeParse({
    personId: String(formData.get("personId") ?? ""),
    requirementId: String(formData.get("requirementId") ?? ""),
    deliveredOn: String(formData.get("deliveredOn") ?? ""),
    expiresOn: expiresOnFromForm(
      formData.get("expiresOn"),
      formData.get("noVence"),
    ),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revisa la entrega.",
    };
  }

  const created = await recordDelivery(companyId, parsed.data, session.user.id);

  if (!created) {
    return { error: "No encontramos ese registro en esta empresa." };
  }

  revalidateDocuments();
  return { ok: true as const };
};

/**
 * HR's decision on an uploaded file (W2-04): accept (it becomes the
 * delivery) or reject with a reason from the closed list. documents:manage.
 */
export const reviewDocumentAction = async (
  formData: FormData,
): Promise<{ ok: true } | { error: string }> => {
  const session = await requireManage();

  if ("error" in session) {
    return session;
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const decision = String(formData.get("decision") ?? "");
  const parsed = reviewDocumentSchema.safeParse(
    decision === "reject"
      ? {
          decision,
          documentId: String(formData.get("documentId") ?? ""),
          reason: String(formData.get("reason") ?? ""),
        }
      : {
          decision,
          documentId: String(formData.get("documentId") ?? ""),
          expiresOn: expiresOnFromForm(
            formData.get("expiresOn"),
            formData.get("noVence"),
          ),
        },
  );

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revisa la decisión.",
    };
  }

  const outcome = await reviewDocument(companyId, parsed.data, session.user.id);

  if (!outcome) {
    return { error: DOCUMENT_FILES_COPY.notFound };
  }

  if ("error" in outcome && outcome.error) {
    return { error: outcome.error };
  }

  revalidateDocuments();
  return { ok: true as const };
};
