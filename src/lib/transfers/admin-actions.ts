"use server";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/tenant/memberships";

import { setGroupAdmin } from "./group-admins";

export type GroupAdminActionState = { error?: string; notice?: string };

/**
 * Platform console: gives or takes the group admin grant (W2-24). Platform
 * admins only, like company and membership management.
 */
export const setGroupAdminAction = async (
  _state: GroupAdminActionState,
  formData: FormData,
): Promise<GroupAdminActionState> => {
  const session = await requireAuth().catch(() => null);

  if (!session || !(await isPlatformAdmin(session.user.id))) {
    return { error: "No tienes permiso para hacer este cambio." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const grant = formData.get("grant") === "1";

  if (!(await setGroupAdmin(email, grant))) {
    return { error: "No hay una cuenta con ese correo." };
  }

  revalidatePath("/admin/grupo");

  return {
    notice: grant
      ? `${email} ya puede consultar el historial del grupo.`
      : `${email} ya no consulta el historial del grupo.`,
  };
};
