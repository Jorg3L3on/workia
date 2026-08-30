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
import { AuthorizationError } from "@/lib/rbac";

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

  const created = await createAsset(parsed.data, session.user.id);
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

  try {
    const { asset } = await assignAsset(parsed.data, session.user.id);
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

  try {
    const { asset, movement } = await returnAsset(parsed.data, session.user.id);
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
    await softDeleteAsset(assetId, session.user.id);
    revalidateResguardo();
    redirect("/app/resguardo?deleted=1");
  } catch (error) {
    redirect(
      `/app/resguardo/${assetId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "delete-failed",
      )}`,
    );
  }
};
