import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";

/** Reports are read with their own permission (WRK-I12): admin by default. */
export const requireReportsRead = async () =>
  requireCompanyContext("reports:read");

/**
 * The turnover goal is company configuration, like the motivos de baja
 * catalog: settings:update, plus reports:read to see what it applies to.
 */
export const requireReportsSettings = async () => {
  const session = await requireCompanyContext("settings:update");

  if (!session.permissions.has("reports:read")) {
    throw new AuthorizationError("Missing permission: reports:read");
  }

  return session;
};
