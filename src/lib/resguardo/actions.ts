"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assignAsset,
  createAsset,
  returnAsset,
  softDeleteAsset,
} from "@/lib/resguardo";
import {
  requireAssetsCreate,
  requireAssetsDelete,
  requireAssetsRead,
  requireAssetsUpdate,
} from "@/lib/resguardo/auth";
import {
  assetFormSchema,
  assignAssetFormSchema,
  returnAssetFormSchema,
} from "@/lib/resguardo/schema";
import { DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

const revalidateResguardo = (personId?: string) => {
  revalidatePath("/app");
  revalidatePath("/app/resguardo");
  revalidatePath("/app/auditoria");

  if (personId) {
    revalidatePath(`/app/personas/${personId}`);
  }
};

export type ResguardoActionState = {
  error?: string;
  success?: boolean;
};

export const assertAssetsListAccess = async () => {
  try {
    return await requireAssetsRead();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/login");
    }

    throw error;
  }
};

export const createAssetAction = async (
  _prev: ResguardoActionState,
  formData: FormData,
): Promise<ResguardoActionState> => {
  let session;

  try {
    session = await requireAssetsCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para registrar activos." };
    }

    redirect("/login");
  }

  const parsed = assetFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    identifier: String(formData.get("identifier") ?? ""),
    category: String(formData.get("category") ?? ""),
    tracksHistory:
      formData.get("tracksHistory") === "on" ||
      formData.get("tracksHistory") === "true",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revisa los datos del activo.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  let created;

  try {
    created = await createAsset(companyId, parsed.data, session.user.id);
  } catch (error) {
    if (error instanceof DuplicateNameError) {
      return { error: error.message };
    }

    throw error;
  }

  revalidateResguardo();
  redirect(`/app/resguardo/${created.id}?created=1`);
};

export const assignAssetAction = async (
  _prev: ResguardoActionState,
  formData: FormData,
): Promise<ResguardoActionState> => {
  let session;

  try {
    session = await requireAssetsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para entregar activos." };
    }

    redirect("/login");
  }

  const parsed = assignAssetFormSchema.safeParse({
    assetId: String(formData.get("assetId") ?? ""),
    personId: String(formData.get("personId") ?? ""),
    movementDate: String(formData.get("movementDate") ?? ""),
    conditionNote: String(formData.get("conditionNote") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Revisa los datos de la entrega.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  try {
    const { asset } = await assignAsset(
      companyId,
      parsed.data,
      session.user.id,
    );
    revalidateResguardo(asset.holderId ?? undefined);
    redirect(`/app/resguardo/${asset.id}?assigned=1`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo registrar la entrega.",
    };
  }
};

export const returnAssetAction = async (
  _prev: ResguardoActionState,
  formData: FormData,
): Promise<ResguardoActionState> => {
  let session;

  try {
    session = await requireAssetsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para registrar devoluciones." };
    }

    redirect("/login");
  }

  const parsed = returnAssetFormSchema.safeParse({
    assetId: String(formData.get("assetId") ?? ""),
    movementDate: String(formData.get("movementDate") ?? ""),
    conditionNote: String(formData.get("conditionNote") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Revisa los datos de la devolución.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  try {
    const { asset, movement } = await returnAsset(
      companyId,
      parsed.data,
      session.user.id,
    );
    revalidateResguardo(movement.personId);
    redirect(`/app/resguardo/${asset.id}?returned=1`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo registrar la devolución.",
    };
  }
};

export const deleteAssetAction = async (assetId: string) => {
  let session;

  try {
    session = await requireAssetsDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/resguardo?error=delete-permission");
    }

    redirect("/login");
  }

  try {
    await softDeleteAsset(session.companyId, assetId, session.user.id);
  } catch (error) {
    redirect(
      `/app/resguardo/${assetId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "delete-failed",
      )}`,
    );
  }

  // Outside the try: redirect() throws, and the catch above would swallow it.
  revalidateResguardo();
  redirect("/app/resguardo?deleted=1");
};
