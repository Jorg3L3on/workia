"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createArea,
  createPosition,
  softDeleteArea,
  softDeletePosition,
} from "@/lib/catalog";
import {
  requireAreasCreate,
  requireAreasDelete,
  requirePositionsCreate,
  requirePositionsDelete,
} from "@/lib/catalog/auth";
import { areaFormSchema, positionFormSchema } from "@/lib/catalog/schema";
import { AuthorizationError } from "@/lib/rbac";

const revalidateCatalog = () => {
  revalidatePath("/app/catalogo");
  revalidatePath("/app/auditoria");
  revalidatePath("/app/personas");
};

const parseAreaForm = (formData: FormData) =>
  areaFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    parentAreaId: String(formData.get("parentAreaId") ?? ""),
    active:
      formData.get("active") === "on" || formData.get("active") === "true",
  });

const parsePositionForm = (formData: FormData) =>
  positionFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    areaId: String(formData.get("areaId") ?? ""),
    active:
      formData.get("active") === "on" || formData.get("active") === "true",
  });

export const createAreaAction = async (formData: FormData) => {
  let session;

  try {
    session = await requireAreasCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/catalogo?error=areas-create");
    }

    redirect("/login");
  }

  const parsed = parseAreaForm(formData);

  if (!parsed.success) {
    redirect("/app/catalogo?error=area-form");
  }

  await createArea(parsed.data, session.user.id);
  revalidateCatalog();
  redirect("/app/catalogo?saved=area");
};

export const deleteAreaAction = async (areaId: string) => {
  let session;

  try {
    session = await requireAreasDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/catalogo?error=areas-delete");
    }

    redirect("/login");
  }

  await softDeleteArea(areaId, session.user.id);
  revalidateCatalog();
  redirect("/app/catalogo?deleted=area");
};

export const createPositionAction = async (formData: FormData) => {
  let session;

  try {
    session = await requirePositionsCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/catalogo?error=positions-create");
    }

    redirect("/login");
  }

  const parsed = parsePositionForm(formData);

  if (!parsed.success) {
    redirect("/app/catalogo?error=position-form");
  }

  await createPosition(parsed.data, session.user.id);
  revalidateCatalog();
  redirect("/app/catalogo?saved=position");
};

export const deletePositionAction = async (positionId: string) => {
  let session;

  try {
    session = await requirePositionsDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect("/app/catalogo?error=positions-delete");
    }

    redirect("/login");
  }

  await softDeletePosition(positionId, session.user.id);
  revalidateCatalog();
  redirect("/app/catalogo?deleted=position");
};
