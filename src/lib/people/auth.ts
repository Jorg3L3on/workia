import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";

export const requirePeoplePermission = async (permission: PermissionSlug) => {
  const session = await requireAuth();
  await requirePermission(session.user.id, permission);
  return session;
};

export const requirePeopleRead = async () =>
  requirePeoplePermission("people:read");

export const requirePeopleCreate = async () =>
  requirePeoplePermission("people:create");

export const requirePeopleUpdate = async () =>
  requirePeoplePermission("people:update");

export const requirePeopleDelete = async () =>
  requirePeoplePermission("people:delete");

export const requirePeopleImport = async () => {
  const session = await requirePeoplePermission("people:import");
  // Importing creates and updates people, so it implies those writes too.
  await requirePermission(session.user.id, "people:create");
  await requirePermission(session.user.id, "people:update");
  return session;
};

/** Exporting includes RFC, CURP, NSS and birth date, so it needs people:read. */
export const requirePeopleExport = async () => {
  const session = await requirePeoplePermission("people:export");
  await requirePermission(session.user.id, "people:read");
  return session;
};
