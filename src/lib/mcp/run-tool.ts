import { randomUUID } from "node:crypto";

import type {
  ServerContext,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { PermissionSlug } from "@/lib/db/schema/types";
import { isoToday } from "@/lib/format/date";
import { logger } from "@/lib/logger";
import { CrossTenantError } from "@/lib/tenant/scope";

import { READ_CALLS_PER_MINUTE } from "./config";
import {
  memberPermissions,
  recordToolCall,
  revokeConnection,
  type McpAuthContext,
} from "./connections";
import {
  McpToolError,
  toolErrorResult,
  type McpErrorPayload,
  type ToolErrorResult,
} from "./errors";
import { hitRateLimit } from "./rate-limit";
import { applyClientCeiling, type McpScope } from "./scopes";

/** Everything a tool handler may use. The company always comes from here, never from input. */
export type WorkiaToolContext = {
  auth: McpAuthContext;
  companyId: string;
  userId: string;
  roleSlug: string;
  /** The user's role permissions in the connection's company, read on this call. */
  permissions: ReadonlySet<PermissionSlug>;
  /** The connection's scopes after the client ceiling. */
  scopes: ReadonlySet<McpScope>;
  /** RFC, CURP, NSS, phone, email and birth date go out in clear only with pii + people:update. */
  piiUnmasked: boolean;
  requestId: string;
  /** "Today" in America/Mexico_City, ISO yyyy-mm-dd. */
  today: string;
};

export type ToolKind = "read" | "write";

// Zod objects convert to JSON Schema 2020-12 for tools/list (SDK).
type AnyObject = z.ZodObject<z.ZodRawShape>;

export type WorkiaTool<
  I extends AnyObject = AnyObject,
  O extends AnyObject = AnyObject,
> = {
  name: string;
  title: string;
  /** Spanish; the model reads it to choose the tool. */
  description: string;
  kind: ToolKind;
  /** Connection scope the call needs. */
  scope: McpScope;
  /** RBAC permission the user needs in the company, the same slug as the UI. */
  permission: PermissionSlug;
  input: I;
  output: O;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<I>, ctx: WorkiaToolContext) => Promise<z.infer<O>>;
};

/** Keeps the input and output types of a tool definition tied together. */
export const defineTool = <I extends AnyObject, O extends AnyObject>(
  tool: WorkiaTool<I, O>,
) => tool as unknown as WorkiaTool;

export const readAnnotations = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const RATE_WINDOW_MS = 60 * 1000;

/** Error fields safe to log: no messages in production (they can echo data or tokens). */
const describeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return { errName: typeof error };
  }

  return {
    errName: error.name,
    errCode: (error as { code?: unknown }).code,
    ...(process.env.NODE_ENV === "production"
      ? {}
      : { errMessage: error.message }),
  };
};

const CHATGPT_WRITE_MESSAGE =
  "Esta conexión de ChatGPT es de sólo lectura. Para hacer cambios usa Grok Bot o la app de Workia.";

/** The bearer context withMcpAuth attached (AuthInfo.extra). */
export const authFromContext = (
  ctx: Pick<ServerContext, "http"> | undefined,
): McpAuthContext | null => {
  const extra = ctx?.http?.authInfo?.extra as
    { workia?: McpAuthContext } | undefined;

  return extra?.workia ?? null;
};

/** Maps anything a handler throws to a stable error payload. */
export const toErrorPayload = (error: unknown): McpErrorPayload => {
  if (error instanceof McpToolError) {
    return error.toPayload();
  }

  if (error instanceof CrossTenantError) {
    // Another company's id answers exactly like a missing one (addendum §3).
    return {
      code: "NOT_FOUND",
      message: "El registro no existe o no está disponible.",
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: "VALIDATION",
      message: "Los datos enviados no son válidos.",
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }

  return { code: "INTERNAL", message: "Error interno de Workia." };
};

const resultFor = (payload: McpErrorPayload) =>
  payload.code === "FORBIDDEN_SCOPE" ||
  payload.code === "FORBIDDEN_RBAC" ||
  payload.code === "RATE_LIMITED" ||
  payload.code === "COMPANY_ACCESS_REVOKED" ||
  payload.code === "UNAUTHENTICATED"
    ? "denied"
    : "error";

export type ToolSuccessResult = {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
};

/**
 * The single door of every tool (D-08): resolves the connection's company
 * and the user's current role there, checks scope ∩ RBAC (∩ the ChatGPT
 * ceiling), applies the per-connection rate limit, runs the handler with the
 * company from the connection, and logs the call to mcp_tool_calls.
 */
export const runWorkiaTool = async (
  tool: WorkiaTool,
  args: unknown,
  sdkContext: Pick<ServerContext, "http"> | undefined,
  now = new Date(),
): Promise<ToolSuccessResult | ToolErrorResult> => {
  const started = performance.now();
  const requestId = randomUUID();
  const auth = authFromContext(sdkContext);

  if (!auth) {
    return toolErrorResult({
      code: "UNAUTHENTICATED",
      message: "Falta un token válido de Workia.",
    });
  }

  let piiUnmasked = false;
  const finish = async (payload: McpErrorPayload | null) => {
    const result = payload ? resultFor(payload) : "success";
    const latencyMs = performance.now() - started;
    const log = {
      tool: tool.name,
      connectionId: auth.connectionId,
      companyId: auth.companyId,
      result,
      errorCode: payload?.code ?? null,
      latencyMs: Math.round(latencyMs),
      requestId,
    };

    if (result === "success") {
      logger.info({ event: "mcp.tool.invoked", ...log }, "mcp.tool.invoked");
    } else {
      logger.warn(
        {
          event: result === "denied" ? "mcp.tool.denied" : "mcp.tool.failed",
          ...log,
        },
        result === "denied" ? "mcp.tool.denied" : "mcp.tool.failed",
      );
    }

    try {
      await recordToolCall({
        companyId: auth.companyId,
        connectionId: auth.connectionId,
        userId: auth.userId,
        tool: tool.name,
        result,
        errorCode: payload?.code ?? null,
        latencyMs,
        requestId,
        piiUnmasked: result === "success" && piiUnmasked,
      });
    } catch (error) {
      logger.error(
        {
          event: "mcp.tool_call.log_failed",
          tool: tool.name,
          requestId,
          ...describeError(error),
        },
        "mcp.tool_call.log_failed",
      );
    }
  };
  const fail = async (payload: McpErrorPayload) => {
    await finish(payload);
    return toolErrorResult(payload);
  };

  try {
    const member = await memberPermissions(auth.userId, auth.companyId);

    if (!member) {
      // Membership revoked or company suspended: cut the connection (addendum §2).
      await revokeConnection(auth.companyId, auth.connectionId, {
        userId: null,
        reason: "company_access_revoked",
      });

      return fail({
        code: "COMPANY_ACCESS_REVOKED",
        message:
          "Ya no tienes acceso a esta empresa en Workia. La conexión quedó revocada; vuelve a conectar si te dan acceso.",
      });
    }

    const scopes = new Set(
      applyClientCeiling(auth.scopes, {
        isChatgpt: auth.isChatgpt,
        allowChatgptPii: member.roleSlug === "super_admin",
      }),
    );

    if (!scopes.has(tool.scope)) {
      return fail({
        code: "FORBIDDEN_SCOPE",
        message:
          auth.isChatgpt && tool.kind === "write"
            ? CHATGPT_WRITE_MESSAGE
            : `Esta conexión no tiene el permiso «${tool.scope}».`,
        details: { required_scope: tool.scope },
      });
    }

    if (!member.permissions.has(tool.permission)) {
      return fail({
        code: "FORBIDDEN_RBAC",
        message: `Tu rol en Workia no permite esta acción (${tool.permission}).`,
        details: { required_permission: tool.permission },
      });
    }

    const limit = await hitRateLimit(
      `mcp:${tool.kind}:${auth.connectionId}`,
      READ_CALLS_PER_MINUTE,
      RATE_WINDOW_MS,
      now,
    );

    if (limit.limited) {
      return fail({
        code: "RATE_LIMITED",
        message: `Demasiadas solicitudes para esta conexión. Reintenta en ${limit.retryAfterSeconds} s.`,
        retry_after_s: limit.retryAfterSeconds,
      });
    }

    piiUnmasked = scopes.has("pii") && member.permissions.has("people:update");

    const input = tool.input.parse(args ?? {});
    const output = await tool.handler(input, {
      auth,
      companyId: auth.companyId,
      userId: auth.userId,
      roleSlug: member.roleSlug,
      permissions: member.permissions,
      scopes,
      piiUnmasked,
      requestId,
      today: isoToday(now),
    });
    const structuredContent = tool.output.parse(output) as Record<
      string,
      unknown
    >;

    await finish(null);

    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  } catch (error) {
    const payload = toErrorPayload(error);

    if (payload.code === "INTERNAL") {
      logger.error(
        {
          event: "mcp.tool.internal_error",
          tool: tool.name,
          requestId,
          ...describeError(error),
        },
        "mcp.tool.internal_error",
      );
    }

    return fail(payload);
  }
};
