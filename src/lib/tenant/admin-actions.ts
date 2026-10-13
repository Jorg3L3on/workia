"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/rbac/errors";

import {
  CompanyError,
  createCompany,
  setCompanyStatus,
  updateCompany,
} from "./companies";
import { requireCompanyContext } from "./context";
import {
  addMember,
  changeMemberRole,
  MemberError,
  revokeMember,
} from "./members";
import { isPlatformAdmin } from "./memberships";
import { STALE_COMPANY_MESSAGE, writableCompanyIdFromForm } from "./scope";

export type AdminActionState = { error?: string; ok?: boolean };

const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

const DENIED = "No tienes permiso para hacer este cambio.";

/** Platform admin, or an error state to return. */
const platformActor = async (): Promise<
  { userId: string } | { error: string }
> => {
  const session = await requireAuth().catch(() => null);

  if (!session || !(await isPlatformAdmin(session.user.id))) {
    return { error: DENIED };
  }

  return { userId: session.user.id };
};

/**
 * Who changes members of which company: the platform (any company, any role)
 * when the form says scope=platform, otherwise a member with members:manage
 * in the active company.
 */
const memberActor = async (
  formData: FormData,
): Promise<
  { userId: string; companyId: string; platform: boolean } | { error: string }
> => {
  if (text(formData, "scope") === "platform") {
    const actor = await platformActor();

    return "error" in actor
      ? actor
      : {
          userId: actor.userId,
          companyId: text(formData, "targetCompanyId"),
          platform: true,
        };
  }

  try {
    const session = await requireCompanyContext("members:manage");

    try {
      return {
        userId: session.user.id,
        companyId: writableCompanyIdFromForm(session, formData),
        platform: false,
      };
    } catch {
      return { error: STALE_COMPANY_MESSAGE };
    }
  } catch (error) {
    return {
      error: error instanceof AuthorizationError ? DENIED : "Sesión no válida.",
    };
  }
};

const revalidateMembers = (companyId: string) => {
  revalidatePath("/app/miembros");
  revalidatePath(`/admin/empresas/${companyId}`);
  revalidatePath("/admin/empresas");
  revalidatePath("/app/auditoria");
};

const asState = (error: unknown): AdminActionState => {
  if (error instanceof MemberError || error instanceof CompanyError) {
    return { error: error.message };
  }

  throw error;
};

export const addMemberAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await memberActor(formData);

  if ("error" in actor) return actor;

  try {
    await addMember(
      actor.companyId,
      { email: text(formData, "email"), roleSlug: text(formData, "roleSlug") },
      actor.userId,
      { platform: actor.platform },
    );
  } catch (error) {
    return asState(error);
  }

  revalidateMembers(actor.companyId);
  return { ok: true };
};

export const changeMemberRoleAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await memberActor(formData);

  if ("error" in actor) return actor;

  try {
    await changeMemberRole(
      actor.companyId,
      text(formData, "membershipId"),
      text(formData, "roleSlug"),
      actor.userId,
      { platform: actor.platform },
    );
  } catch (error) {
    return asState(error);
  }

  revalidateMembers(actor.companyId);
  return { ok: true };
};

export const revokeMemberAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await memberActor(formData);

  if ("error" in actor) return actor;

  try {
    await revokeMember(
      actor.companyId,
      text(formData, "membershipId"),
      actor.userId,
      { platform: actor.platform },
    );
  } catch (error) {
    return asState(error);
  }

  revalidateMembers(actor.companyId);
  return { ok: true };
};

const companyInput = (formData: FormData) => ({
  name: text(formData, "name"),
  slug: text(formData, "slug"),
  legalName: text(formData, "legalName"),
  rfc: text(formData, "rfc"),
});

export const createCompanyAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await platformActor();

  if ("error" in actor) return actor;

  let companyId: string;

  try {
    companyId = (await createCompany(companyInput(formData), actor.userId)).id;
  } catch (error) {
    return asState(error);
  }

  revalidatePath("/admin/empresas");
  redirect(`/admin/empresas/${companyId}?created=1`);
};

export const updateCompanyAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await platformActor();

  if ("error" in actor) return actor;

  const companyId = text(formData, "targetCompanyId");

  try {
    await updateCompany(companyId, companyInput(formData), actor.userId);
  } catch (error) {
    return asState(error);
  }

  revalidateMembers(companyId);
  return { ok: true };
};

export const setCompanyStatusAction = async (
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> => {
  const actor = await platformActor();

  if ("error" in actor) return actor;

  const companyId = text(formData, "targetCompanyId");
  const status =
    text(formData, "status") === "suspendida" ? "suspendida" : "activa";

  try {
    await setCompanyStatus(companyId, status, actor.userId);
  } catch (error) {
    return asState(error);
  }

  revalidateMembers(companyId);
  return { ok: true };
};
