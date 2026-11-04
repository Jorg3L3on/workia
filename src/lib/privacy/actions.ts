"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isoToday } from "@/lib/format/date";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { requirePrivacyManage } from "./auth";
import {
  createArcoRequest,
  publishPrivacyNotice,
  recordPrivacyAcceptance,
  resolveArcoRequest,
  searchPeopleForPrivacy,
} from "./index";
import {
  createArcoRequestSchema,
  PRIVACY_COPY,
  publishNoticeSchema,
  recordAcceptanceSchema,
  resolveArcoRequestSchema,
  type PrivacyActionState,
} from "./schema";

const PRIVACY_PATH = "/app/privacidad";

const revalidatePrivacy = () => {
  revalidatePath(PRIVACY_PATH);
  revalidatePath("/app/auditoria");
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
};

/** The manage session and the company the form was rendered for, or an error state. */
const manageContext = async (formData: FormData) => {
  let session: Awaited<ReturnType<typeof requirePrivacyManage>>;

  try {
    session = await requirePrivacyManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: PRIVACY_COPY.denied } as const;
    }

    redirect("/login");
  }

  try {
    return {
      userId: session.user.id,
      companyId: writableCompanyIdFromForm(session, formData),
    } as const;
  } catch {
    return { error: STALE_COMPANY_MESSAGE } as const;
  }
};

/** Publishes the next version of the notice. */
export const publishPrivacyNoticeAction = async (
  _state: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = publishNoticeSchema.safeParse({
    body: text(formData, "body"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? PRIVACY_COPY.noticeBody,
    };
  }

  const result = await publishPrivacyNotice(
    context.companyId,
    parsed.data,
    context.userId,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePrivacy();
  return { ok: true, message: PRIVACY_COPY.noticePublished };
};

/** HR records that a person accepted the version in force on paper. */
export const recordPrivacyAcceptanceAction = async (
  _state: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = recordAcceptanceSchema.safeParse({
    personId: text(formData, "personId"),
    noticeId: text(formData, "noticeId"),
    channel: "hr",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PRIVACY_COPY.person };
  }

  const result = await recordPrivacyAcceptance(
    context.companyId,
    parsed.data,
    context.userId,
  );

  if (!result) {
    return { error: PRIVACY_COPY.personNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePrivacy();
  return { ok: true, message: PRIVACY_COPY.acceptanceRecorded };
};

/** Registers an ARCO request HR received (email, paper, in person). */
export const createArcoRequestAction = async (
  _state: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = createArcoRequestSchema.safeParse({
    personId: text(formData, "personId"),
    kind: text(formData, "kind"),
    channel: "hr",
    detail: text(formData, "detail"),
    receivedOn: text(formData, "receivedOn"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? PRIVACY_COPY.arcoDetail,
    };
  }

  const result = await createArcoRequest(
    context.companyId,
    parsed.data,
    context.userId,
    isoToday(),
  );

  if (!result) {
    return { error: PRIVACY_COPY.personNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePrivacy();
  return { ok: true, message: PRIVACY_COPY.arcoCreated };
};

/** Closes an open request as attended or improcedente, with the answer. */
export const resolveArcoRequestAction = async (
  _state: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = resolveArcoRequestSchema.safeParse({
    requestId: text(formData, "requestId"),
    outcome: text(formData, "outcome"),
    response: text(formData, "response"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? PRIVACY_COPY.arcoResponse,
    };
  }

  const result = await resolveArcoRequest(
    context.companyId,
    parsed.data,
    context.userId,
  );

  if (!result) {
    return { error: PRIVACY_COPY.arcoNotFound };
  }

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePrivacy();
  return { ok: true, message: PRIVACY_COPY.arcoResolved };
};

/** Person search for the ARCO and acceptance forms; people on baja included. */
export const searchPrivacyPeopleAction = async (query: string) => {
  try {
    const session = await requirePrivacyManage();

    return await searchPeopleForPrivacy(session.companyId, query);
  } catch {
    return [];
  }
};
