import { requireCompanyContext } from "@/lib/tenant/context";

/** Motivos de baja are read with the expediente (people:read). */
export const requireTerminationReasonsRead = async () =>
  requireCompanyContext("people:read");

/**
 * Editing the catalog is company configuration, like the rest of Catálogo
 * (admin): settings:update. Giving a baja only needs people:update.
 */
export const requireTerminationReasonsManage = async () =>
  requireCompanyContext("settings:update");
