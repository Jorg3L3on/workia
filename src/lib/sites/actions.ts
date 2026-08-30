"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { AuthorizationError } from "@/lib/rbac";

import { createSite, softDeleteSite } from "./index";
import { requireSitesCreate, requireSitesDelete } from "./auth";
import { siteFormSchema } from "./schema";

const revalidateSites = () => {
  revalidatePath(CATALOG_PATHS.index);
  revalidatePath(CATALOG_PATHS.sucursales);
  revalidatePath("/app/auditoria");
  revalidatePath("/app/personas");
};

export const createSiteAction = async (formData: FormData) => {
  let session;

  try {
    session = await requireSitesCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "sites-create" }),
      );
    }

    redirect("/login");
  }

  const parsed = siteFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    kind: String(formData.get("kind") ?? "sucursal"),
  });

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.sucursales, { error: "site-form" }));
  }

  await createSite(parsed.data, session.user.id);
  revalidateSites();
  redirect(catalogHref(CATALOG_PATHS.sucursales, { saved: "site" }));
};

export const deleteSiteAction = async (siteId: string) => {
  let session;

  try {
    session = await requireSitesDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "sites-delete" }),
      );
    }

    redirect("/login");
  }

  await softDeleteSite(siteId, session.user.id);
  revalidateSites();
  redirect(catalogHref(CATALOG_PATHS.sucursales, { deleted: "site" }));
};
