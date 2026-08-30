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
import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { areaFormSchema, positionFormSchema } from "@/lib/catalog/schema";
import { AuthorizationError } from "@/lib/rbac";

const revalidateCatalog = () => {
  revalidatePath(CATALOG_PATHS.index);
  revalidatePath(CATALOG_PATHS.areas);
  revalidatePath(CATALOG_PATHS.puestos);
  revalidatePath(CATALOG_PATHS.sucursales);
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
      redirect(catalogHref(CATALOG_PATHS.areas, { error: "areas-create" }));
    }

    redirect("/login");
  }

  const parsed = parseAreaForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.areas, { error: "area-form" }));
  }

  await createArea(parsed.data, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.areas, { saved: "area" }));
};

export const deleteAreaAction = async (areaId: string) => {
  let session;

  try {
    session = await requireAreasDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(catalogHref(CATALOG_PATHS.areas, { error: "areas-delete" }));
    }

    redirect("/login");
  }

  await softDeleteArea(areaId, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.areas, { deleted: "area" }));
};

export const createPositionAction = async (formData: FormData) => {
  let session;

  try {
    session = await requirePositionsCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.puestos, { error: "positions-create" }),
      );
    }

    redirect("/login");
  }

  const parsed = parsePositionForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: "position-form" }));
  }

  await createPosition(parsed.data, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.puestos, { saved: "position" }));
};

export const deletePositionAction = async (positionId: string) => {
  let session;

  try {
    session = await requirePositionsDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.puestos, { error: "positions-delete" }),
      );
    }

    redirect("/login");
  }

  await softDeletePosition(positionId, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.puestos, { deleted: "position" }));
};
