import type { PermissionSlug } from "@/lib/db/schema/types";
import { requireCompanyContext } from "@/lib/tenant/context";
import { requirePermission } from "@/lib/rbac";

export const requirePeoplePermission = (permission: PermissionSlug) =>
  // The company context (active company + membership permissions) is the door
  // to business data; callers read `session.companyId` for every query.
  requireCompanyContext(permission);

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

/** Undoing an import soft-deletes the people it created. */
export const requirePeopleUndoImport = async () => {
  const session = await requirePeopleImport();
  await requirePermission(session.user.id, "people:delete");
  return session;
};
