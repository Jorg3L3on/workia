"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assignActivityToPosition,
  createActivity,
  createArea,
  createPosition,
  softDeleteActivity,
  softDeleteArea,
  softDeletePosition,
  unassignActivityFromPosition,
  updateActivity,
} from "@/lib/catalog";
import {
  requireActivitiesCreate,
  requireActivitiesDelete,
  requireActivitiesUpdate,
  requireAreasCreate,
  requireAreasDelete,
  requirePositionsCreate,
  requirePositionsDelete,
  requirePositionsUpdate,
} from "@/lib/catalog/auth";
import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import {
  activityFormSchema,
  areaFormSchema,
  positionActivityFormSchema,
  positionFormSchema,
} from "@/lib/catalog/schema";
import { AuthorizationError } from "@/lib/rbac";

const revalidateCatalog = () => {
  revalidatePath(CATALOG_PATHS.index);
  revalidatePath(CATALOG_PATHS.areas);
  revalidatePath(CATALOG_PATHS.puestos);
  revalidatePath(CATALOG_PATHS.actividades);
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

const parseActivityForm = (formData: FormData) =>
  activityFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    active:
      formData.get("active") === "on" || formData.get("active") === "true",
  });

const parsePositionActivityForm = (formData: FormData) =>
  positionActivityFormSchema.safeParse({
    positionId: String(formData.get("positionId") ?? ""),
    activityId: String(formData.get("activityId") ?? ""),
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

export const createActivityAction = async (formData: FormData) => {
  let session;

  try {
    session = await requireActivitiesCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.actividades, { error: "activities-create" }),
      );
    }

    redirect("/login");
  }

  const parsed = parseActivityForm(formData);

  if (!parsed.success) {
    redirect(
      catalogHref(CATALOG_PATHS.actividades, { error: "activity-form" }),
    );
  }

  await createActivity(parsed.data, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.actividades, { saved: "activity" }));
};

export const updateActivityAction = async (
  activityId: string,
  formData: FormData,
) => {
  let session;

  try {
    session = await requireActivitiesUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.actividades, { error: "activities-update" }),
      );
    }

    redirect("/login");
  }

  const parsed = parseActivityForm(formData);

  if (!parsed.success) {
    redirect(
      catalogHref(CATALOG_PATHS.actividades, {
        error: "activity-form",
        edit: activityId,
      }),
    );
  }

  await updateActivity(activityId, parsed.data, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.actividades, { saved: "activity" }));
};

export const deleteActivityAction = async (activityId: string) => {
  let session;

  try {
    session = await requireActivitiesDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.actividades, { error: "activities-delete" }),
      );
    }

    redirect("/login");
  }

  await softDeleteActivity(activityId, session.user.id);
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.actividades, { deleted: "activity" }));
};

export const assignActivityToPositionAction = async (formData: FormData) => {
  let session;

  try {
    session = await requirePositionsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.puestos, { error: "positions-update" }),
      );
    }

    redirect("/login");
  }

  const parsed = parsePositionActivityForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: "assign-form" }));
  }

  const result = await assignActivityToPosition(
    parsed.data.positionId,
    parsed.data.activityId,
    session.user.id,
  );

  if (!result.ok) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: result.reason }));
  }

  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.puestos, { assigned: "activity" }));
};

export const unassignActivityFromPositionAction = async (
  formData: FormData,
) => {
  let session;

  try {
    session = await requirePositionsUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.puestos, { error: "positions-update" }),
      );
    }

    redirect("/login");
  }

  const parsed = parsePositionActivityForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: "unassign-form" }));
  }

  await unassignActivityFromPosition(
    parsed.data.positionId,
    parsed.data.activityId,
    session.user.id,
  );
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.puestos, { unassigned: "activity" }));
};
