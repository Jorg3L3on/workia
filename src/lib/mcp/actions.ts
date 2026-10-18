"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { NEW_CONNECTIONS_PER_HOUR, PAT_EXPIRY_DAYS } from "./config";
import {
  countRecentConnections,
  createPersonalToken,
  getConnection,
  hideConnection,
  revokeConnection,
} from "./connections";
import { scopesForPreset, TOKEN_PRESETS } from "./presets";
import { setMcpWritesEnabled } from "./settings";
import { isMcpScope } from "./scopes";

export type CreateTokenState = {
  error?: string;
  /** Shown once, never stored in clear. */
  token?: string;
  name?: string;
  scopes?: string[];
  expiresAt?: string;
};

export type ConnectionActionState = { error?: string; ok?: boolean };

const DENIED = "No tienes permiso para hacer este cambio.";

const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre.").max(80),
  preset: z.enum(TOKEN_PRESETS),
  expiresInDays: z.coerce
    .number()
    .refine(
      (value) => (PAT_EXPIRY_DAYS as readonly number[]).includes(value),
      "Elige 7, 30 o 90 días.",
    ),
});

const revalidateConnections = () => {
  revalidatePath("/app/conexiones");
  revalidatePath("/app/auditoria");
};

/** A personal access token (PAT) for the signed-in user in the active company. */
export const createPersonalTokenAction = async (
  _state: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> => {
  let session;

  try {
    session = await requireCompanyContext("mcp_connections:create");
  } catch (error) {
    return {
      error: error instanceof AuthorizationError ? DENIED : "Sesión no válida.",
    };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const parsed = createTokenSchema.safeParse({
    name: formData.get("name"),
    preset: formData.get("preset"),
    expiresInDays: formData.get("expiresInDays"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);

  if (
    (await countRecentConnections(companyId, session.userId, since)) >=
    NEW_CONNECTIONS_PER_HOUR
  ) {
    return {
      error:
        "Creaste demasiadas conexiones en la última hora. Intenta más tarde.",
    };
  }

  const custom = formData.getAll("scopes").map(String).filter(isMcpScope);
  const { connection, token } = await createPersonalToken(companyId, {
    userId: session.userId,
    name: parsed.data.name,
    scopes: scopesForPreset(parsed.data.preset, custom),
    expiresInDays: parsed.data
      .expiresInDays as (typeof PAT_EXPIRY_DAYS)[number],
  });

  revalidateConnections();

  return {
    token,
    name: connection.name,
    scopes: connection.scopes,
    expiresAt: connection.tokenExpiresAt.toISOString(),
  };
};

/**
 * Loads a connection of the active company the user may act on: their own, or
 * anyone's with mcp_connections:manage. Another company's id is "not found".
 */
const actOnConnection = async (formData: FormData) => {
  const session = await requireCompanyContext();
  const companyId = writableCompanyIdFromForm(session, formData);
  const connection = await getConnection(
    companyId,
    String(formData.get("connectionId") ?? ""),
  );

  if (!connection) {
    return { error: "La conexión no existe." } as const;
  }

  const own = connection.userId === session.userId;

  if (
    (own && !session.permissions.has("mcp_connections:create")) ||
    (!own && !session.permissions.has("mcp_connections:manage"))
  ) {
    return { error: DENIED } as const;
  }

  return { session, companyId, connection } as const;
};

const guarded = async (
  formData: FormData,
  fn: (
    target: Exclude<
      Awaited<ReturnType<typeof actOnConnection>>,
      { error: string }
    >,
  ) => Promise<ConnectionActionState>,
): Promise<ConnectionActionState> => {
  try {
    const target = await actOnConnection(formData);

    return "error" in target ? { error: target.error } : await fn(target);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        error:
          error.name === "CrossTenantError" ? STALE_COMPANY_MESSAGE : DENIED,
      };
    }

    throw error;
  }
};

/** Revokes a connection: the next call with its token fails. */
export const revokeConnectionAction = async (
  _state: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> =>
  guarded(formData, async ({ session, companyId, connection }) => {
    await revokeConnection(companyId, connection.id, {
      userId: session.userId,
      reason: "revoked_in_app",
    });
    revalidateConnections();
    return { ok: true };
  });

/** Hides a revoked or expired connection from the list (it stays in the log). */
export const hideConnectionAction = async (
  _state: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> =>
  guarded(formData, async ({ companyId, connection }) => {
    const expired =
      connection.tokenExpiresAt <= new Date() &&
      (!connection.refreshExpiresAt ||
        connection.refreshExpiresAt <= new Date());

    if (!connection.revokedAt && !expired) {
      return { error: "Revoca la conexión antes de ocultarla." };
    }

    await hideConnection(companyId, connection.id);
    revalidateConnections();
    return { ok: true };
  });

/**
 * Turns MCP writes on or off for the active company (super_admin only, spec
 * §7). Effective on the next tool call.
 */
export const setWritesEnabledAction = async (
  _state: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> => {
  try {
    const session = await requireCompanyContext("mcp_connections:manage");

    if (session.membership.roleSlug !== "super_admin") {
      return {
        error: "Sólo un super_admin puede encender o apagar las escrituras.",
      };
    }

    const companyId = writableCompanyIdFromForm(session, formData);
    await setMcpWritesEnabled(
      companyId,
      formData.get("enabled") === "true",
      session.userId,
    );
    revalidateConnections();
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        error:
          error.name === "CrossTenantError" ? STALE_COMPANY_MESSAGE : DENIED,
      };
    }

    throw error;
  }
};
