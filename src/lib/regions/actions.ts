"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  requireSitesCreate,
  requireSitesDelete,
  requireSitesUpdate,
} from "@/lib/sites/auth";
import { writableCompanyIdFromForm } from "@/lib/tenant/scope";

import { createRegion, softDeleteRegion, updateRegion } from "./index";
import { regionFormSchema } from "./schema";

const revalidateRegions = () => {
  revalidatePath(CATALOG_PATHS.regiones);
  revalidatePath(CATALOG_PATHS.sucursales);
  revalidatePath("/app/auditoria");
  revalidatePath("/app/personas");
  revalidatePath("/app/contratos");
};

// Typed on the binding so TypeScript narrows after a call (it never returns).
const back: (query: Record<string, string>) => never = (query) =>
  redirect(catalogHref(CATALOG_PATHS.regiones, query));

const parseRegionForm = (formData: FormData) =>
  regionFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    active:
      formData.get("active") === null
        ? true
        : formData.get("active") === "on" || formData.get("active") === "true",
  });

const onDuplicate = (error: unknown) => {
  if (error instanceof DuplicateNameError) {
    back({ error: "duplicate-name" });
  }

  throw error;
};

export const createRegionAction = async (formData: FormData) => {
  let session;

  try {
    session = await requireSitesCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) back({ error: "regions-create" });
    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    back({ error: "company-changed" });
  }

  const parsed = parseRegionForm(formData);

  if (!parsed.success) {
    back({ error: "region-form" });
  }

  await createRegion(companyId, parsed.data, session.user.id).catch(
    onDuplicate,
  );
  revalidateRegions();
  back({ saved: "region" });
};

export const updateRegionAction = async (
  regionId: string,
  formData: FormData,
) => {
  let session;

  try {
    session = await requireSitesUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) back({ error: "regions-update" });
    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    back({ error: "company-changed" });
  }

  const parsed = parseRegionForm(formData);

  if (!parsed.success) {
    back({ error: "region-form" });
  }

  const updated = await updateRegion(
    companyId,
    regionId,
    parsed.data,
    session.user.id,
  ).catch(onDuplicate);

  if (!updated) {
    back({ error: "not-found" });
  }

  revalidateRegions();
  back({ saved: "region" });
};

export const deleteRegionAction = async (regionId: string) => {
  let session;

  try {
    session = await requireSitesDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) back({ error: "regions-delete" });
    redirect("/login");
  }

  await softDeleteRegion(session.companyId, regionId, session.user.id);
  revalidateRegions();
  back({ deleted: "region" });
};
