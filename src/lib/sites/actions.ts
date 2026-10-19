"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CATALOG_PATHS, catalogHref } from "@/lib/catalog/paths";
import { DuplicateNameError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import { writableCompanyIdFromForm } from "@/lib/tenant/scope";

import {
  createSite,
  RegionNotFoundError,
  setSiteRegion,
  softDeleteSite,
  updateSite,
} from "./index";
import {
  requireSitesCreate,
  requireSitesDelete,
  requireSitesUpdate,
} from "./auth";
import { siteFormSchema } from "./schema";

const revalidateSites = () => {
  revalidatePath(CATALOG_PATHS.index);
  revalidatePath(CATALOG_PATHS.sucursales);
  revalidatePath(CATALOG_PATHS.regiones);
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

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    redirect(
      catalogHref(CATALOG_PATHS.sucursales, { error: "company-changed" }),
    );
  }

  const parsed = siteFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    kind: String(formData.get("kind") ?? "sucursal"),
    regionId: String(formData.get("regionId") ?? ""),
  });

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.sucursales, { error: "site-form" }));
  }

  await createSite(companyId, parsed.data, session.user.id).catch(
    (error: unknown) => {
      if (error instanceof DuplicateNameError) {
        redirect(
          catalogHref(CATALOG_PATHS.sucursales, { error: "duplicate-name" }),
        );
      }

      if (error instanceof RegionNotFoundError) {
        redirect(
          catalogHref(CATALOG_PATHS.sucursales, { error: "region-not-found" }),
        );
      }

      throw error;
    },
  );
  revalidateSites();
  redirect(catalogHref(CATALOG_PATHS.sucursales, { saved: "site" }));
};

/** Name, kind and region from the sucursal sheet (WRK-I6-5). */
export const updateSiteAction = async (siteId: string, formData: FormData) => {
  let session;

  try {
    session = await requireSitesUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "sites-update" }),
      );
    }

    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    redirect(
      catalogHref(CATALOG_PATHS.sucursales, { error: "company-changed" }),
    );
  }

  const parsed = siteFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    kind: String(formData.get("kind") ?? "sucursal"),
    regionId: String(formData.get("regionId") ?? ""),
  });

  if (!parsed.success) {
    redirect(catalogHref(CATALOG_PATHS.sucursales, { error: "site-form" }));
  }

  const onError = (error: unknown): never => {
    if (error instanceof DuplicateNameError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "duplicate-name" }),
      );
    }

    if (error instanceof RegionNotFoundError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "region-not-found" }),
      );
    }

    throw error;
  };

  const updated = await updateSite(
    companyId,
    siteId,
    parsed.data,
    session.user.id,
  ).catch(onError);

  if (!updated) {
    redirect(catalogHref(CATALOG_PATHS.sucursales, { error: "not-found" }));
  }

  await setSiteRegion(
    companyId,
    siteId,
    parsed.data.regionId || null,
    session.user.id,
  ).catch(onError);
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

  await softDeleteSite(session.companyId, siteId, session.user.id);
  revalidateSites();
  redirect(catalogHref(CATALOG_PATHS.sucursales, { deleted: "site" }));
};

/** Assigns a site's region from the sites table (WRK-I5-4); "" takes it out of any. */
export const setSiteRegionAction = async (
  siteId: string,
  formData: FormData,
) => {
  let session;

  try {
    session = await requireSitesUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(
        catalogHref(CATALOG_PATHS.sucursales, { error: "sites-update" }),
      );
    }

    redirect("/login");
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    redirect(
      catalogHref(CATALOG_PATHS.sucursales, { error: "company-changed" }),
    );
  }

  const regionId = String(formData.get("regionId") ?? "") || null;

  await setSiteRegion(companyId, siteId, regionId, session.user.id).catch(
    (error: unknown) => {
      if (error instanceof RegionNotFoundError) {
        redirect(
          catalogHref(CATALOG_PATHS.sucursales, { error: "region-not-found" }),
        );
      }

      throw error;
    },
  );
  revalidateSites();
  redirect(catalogHref(CATALOG_PATHS.sucursales, { saved: "site" }));
};
