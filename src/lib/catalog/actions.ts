"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assignActivityToPosition,
  createActivity,
  createArea,
  createPosition,
  listActivitiesForPosition,
  listAreas,
  softDeleteActivity,
  softDeleteArea,
  softDeletePosition,
  unassignActivityFromPosition,
  updateActivity,
  updateArea,
  updatePosition,
} from "@/lib/catalog";
import {
  requireActivitiesCreate,
  requireActivitiesDelete,
  requireActivitiesUpdate,
  requireAreasCreate,
  requireAreasDelete,
  requireAreasUpdate,
  requirePositionsCreate,
  requirePositionsDelete,
  requirePositionsUpdate,
} from "@/lib/catalog/auth";
import {
  CATALOG_PATHS,
  catalogHref,
  type CatalogPath,
} from "@/lib/catalog/paths";
import {
  activityFormSchema,
  areaFormSchema,
  positionActivityFormSchema,
  positionFormSchema,
} from "@/lib/catalog/schema";
import { CompanyReferenceError, DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import { writableCompanyIdFromForm } from "@/lib/tenant/scope";

/** The active company, or back to the list when the form was opened in another company. */
const formCompanyOrRedirect = (
  session: { companyId: string },
  formData: FormData,
  path: CatalogPath,
) => {
  try {
    return writableCompanyIdFromForm(session, formData);
  } catch {
    redirect(catalogHref(path, { error: "company-changed" }));
  }
};

/** `.catch()` for writes: a duplicate name or a foreign reference goes back to the list with a message. */
const duplicateNameRedirect =
  (path: CatalogPath) =>
  (error: unknown): never => {
    if (error instanceof DuplicateNameError) {
      redirect(catalogHref(path, { error: "duplicate-name" }));
    }

    if (error instanceof CompanyReferenceError) {
      redirect(catalogHref(path, { error: "reference" }));
    }

    throw error;
  };

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

/** The puesto sheet sends its activity chips as `activityId` fields, marked by `syncActivities`. */
const activityIdsFromForm = (formData: FormData) =>
  formData.get("syncActivities") === "true"
    ? [...new Set(formData.getAll("activityId").map(String).filter(Boolean))]
    : null;

/** Makes a puesto's activities match the sheet's chips; returns the first refusal, if any. */
const syncPositionActivities = async (
  companyId: string,
  positionId: string,
  wanted: string[],
  actorUserId: string,
) => {
  const current = (await listActivitiesForPosition(companyId, positionId)).map(
    (activity) => activity.id,
  );

  for (const activityId of current.filter((id) => !wanted.includes(id))) {
    await unassignActivityFromPosition(
      companyId,
      positionId,
      activityId,
      actorUserId,
    );
  }

  for (const activityId of wanted.filter((id) => !current.includes(id))) {
    const result = await assignActivityToPosition(
      companyId,
      positionId,
      activityId,
      actorUserId,
    );

    if (!result.ok) return result.reason;
  }

  return null;
};

/** True when `parentAreaId` is the area itself or one of its descendants. */
const wouldCycle = async (
  companyId: string,
  areaId: string,
  parentAreaId: string | undefined,
) => {
  if (!parentAreaId) return false;

  const parentOf = new Map(
    (await listAreas(companyId)).map((area) => [area.id, area.parentAreaId]),
  );
  let cursor: string | null | undefined = parentAreaId;

  for (let hops = 0; cursor && hops <= parentOf.size; hops += 1) {
    if (cursor === areaId) return true;
    cursor = parentOf.get(cursor);
  }

  return false;
};

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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.areas,
  );

  await createArea(companyId, parsed.data, session.user.id).catch(
    duplicateNameRedirect(CATALOG_PATHS.areas),
  );
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.areas, { saved: "area" }));
};

export const updateAreaAction = async (areaId: string, formData: FormData) => {
  let session;

  try {
    session = await requireAreasUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(catalogHref(CATALOG_PATHS.areas, { error: "areas-update" }));
    }

    redirect("/login");
  }

  const parsed = parseAreaForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.areas, { error: "area-form" }));
  }

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.areas,
  );

  if (await wouldCycle(companyId, areaId, parsed.data.parentAreaId)) {
    redirect(catalogHref(CATALOG_PATHS.areas, { error: "area-cycle" }));
  }

  const updated = await updateArea(
    companyId,
    areaId,
    parsed.data,
    session.user.id,
  ).catch(duplicateNameRedirect(CATALOG_PATHS.areas));

  if (!updated) {
    redirect(catalogHref(CATALOG_PATHS.areas, { error: "not-found" }));
  }

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

  await softDeleteArea(session.companyId, areaId, session.user.id);
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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.puestos,
  );

  const created = await createPosition(
    companyId,
    parsed.data,
    session.user.id,
  ).catch(duplicateNameRedirect(CATALOG_PATHS.puestos));
  const activityIds = activityIdsFromForm(formData);
  const refused = activityIds
    ? await syncPositionActivities(
        companyId,
        created.id,
        activityIds,
        session.user.id,
      )
    : null;

  revalidateCatalog();
  redirect(
    catalogHref(
      CATALOG_PATHS.puestos,
      refused ? { error: refused } : { saved: "position" },
    ),
  );
};

export const updatePositionAction = async (
  positionId: string,
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

  const parsed = parsePositionForm(formData);

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: "position-form" }));
  }

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.puestos,
  );

  const updated = await updatePosition(
    companyId,
    positionId,
    parsed.data,
    session.user.id,
  ).catch(duplicateNameRedirect(CATALOG_PATHS.puestos));

  if (!updated) {
    redirect(catalogHref(CATALOG_PATHS.puestos, { error: "not-found" }));
  }

  const activityIds = activityIdsFromForm(formData);
  const refused = activityIds
    ? await syncPositionActivities(
        companyId,
        positionId,
        activityIds,
        session.user.id,
      )
    : null;

  revalidateCatalog();
  redirect(
    catalogHref(
      CATALOG_PATHS.puestos,
      refused ? { error: refused } : { saved: "position" },
    ),
  );
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

  await softDeletePosition(session.companyId, positionId, session.user.id);
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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.actividades,
  );

  await createActivity(companyId, parsed.data, session.user.id).catch(
    duplicateNameRedirect(CATALOG_PATHS.actividades),
  );
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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.actividades,
  );

  await updateActivity(
    companyId,
    activityId,
    parsed.data,
    session.user.id,
  ).catch(duplicateNameRedirect(CATALOG_PATHS.actividades));
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

  await softDeleteActivity(session.companyId, activityId, session.user.id);
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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.puestos,
  );

  const result = await assignActivityToPosition(
    companyId,
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

  const companyId = formCompanyOrRedirect(
    session,
    formData,
    CATALOG_PATHS.puestos,
  );

  await unassignActivityFromPosition(
    companyId,
    parsed.data.positionId,
    parsed.data.activityId,
    session.user.id,
  );
  revalidateCatalog();
  redirect(catalogHref(CATALOG_PATHS.puestos, { unassigned: "activity" }));
};
