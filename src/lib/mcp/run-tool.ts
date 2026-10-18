import { randomUUID } from "node:crypto";

import type {
  ServerContext,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { runWithAuditContext } from "@/lib/audit/context";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { formatDateTimeMx, isoToday } from "@/lib/format/date";
import { logger } from "@/lib/logger";
import { CrossTenantError } from "@/lib/tenant/scope";

import {
  argsHash,
  issueConfirmationToken,
  verifyConfirmationToken,
} from "./confirm";
import {
  publicOrigin,
  READ_CALLS_PER_MINUTE,
  WRITE_CALLS_PER_MINUTE,
} from "./config";
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
import {
  completeIdempotencyKey,
  findIdempotentReply,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from "./idempotency";
import { hitRateLimit } from "./rate-limit";
import { getMcpSettings } from "./settings";
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
  /** Public origin of the app, for links back to Workia. */
  origin: string;
};

export type ToolKind = "read" | "write";

// Zod objects convert to JSON Schema 2020-12 for tools/list (SDK).
type AnyObject = z.ZodObject<z.ZodRawShape>;

/** What a write tool shows before it writes: a Spanish summary, dates in dd/mm/aaaa. */
export const writePreviewSchema = z.object({
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
});

export type WritePreview = z.infer<typeof writePreviewSchema>;

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
  /**
   * Write tools only: validates, checks the business rules and describes the
   * change without writing (spec §7, D-06). The handler runs only after a
   * second call carries the confirmation token this preview earned.
   */
  preview?: (args: z.infer<I>, ctx: WorkiaToolContext) => Promise<WritePreview>;
};

/** Keeps the input and output types of a tool definition tied together. */
export const defineTool = <I extends AnyObject, O extends AnyObject>(
  tool: WorkiaTool<I, O>,
) => tool as unknown as WorkiaTool;

/** Every write tool takes these two control fields (spec §8). */
const writeControls = {
  idempotency_key: z
    .string()
    .min(8)
    .max(80)
    .describe(
      "Llave única de esta operación (8–80 caracteres). Repetirla con los mismos datos devuelve el mismo resultado sin duplicar.",
    ),
  confirmation_token: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Token de la vista previa. Sin él la herramienta sólo muestra qué haría; con él, lo hace. Vence en 10 minutos.",
    ),
};

const writeEnvelope = {
  status: z
    .enum(["preview", "done"])
    .describe(
      "preview: nada se escribió todavía; done: el cambio quedó hecho.",
    ),
  code: z.literal("CONFIRMATION_REQUIRED").optional(),
  preview: writePreviewSchema.optional(),
  confirmation_token: z.string().optional(),
  expires_at: z.string().optional(),
  expires_at_mx: z.string().optional(),
  audit_event_ids: z.array(z.string()).optional(),
};

/**
 * A write tool: `preview` describes the change, `handler` makes it through the
 * existing domain function. The input gains idempotency_key and
 * confirmation_token; the output gains the preview/done envelope.
 */
export const defineWriteTool = <I extends AnyObject, O extends AnyObject>(
  tool: Omit<WorkiaTool<I, O>, "kind" | "preview"> & {
    preview: NonNullable<WorkiaTool<I, O>["preview"]>;
  },
) =>
  ({
    ...tool,
    kind: "write",
    input: tool.input.extend(writeControls),
    output: tool.output.partial().extend(writeEnvelope),
  }) as unknown as WorkiaTool;

export const writeAnnotations = (
  title: string,
  options: { destructive?: boolean } = {},
): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: options.destructive ?? false,
  // Idempotent by idempotency_key.
  idempotentHint: true,
  openWorldHint: false,
});

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

const originFromContext = (ctx: Pick<ServerContext, "http"> | undefined) => {
  const extra = ctx?.http?.authInfo?.extra as { origin?: string } | undefined;

  return extra?.origin ?? publicOrigin();
};

/**
 * Maps anything a handler throws to a stable error payload. Domain functions
 * refuse business rule violations with a plain Error and a Spanish message
 * ("Esta persona ya tiene un contrato vigente."): in a write that is CONFLICT.
 * Database errors (they carry a code) stay INTERNAL and never show details.
 */
export const toErrorPayload = (
  error: unknown,
  options: { write?: boolean } = {},
): McpErrorPayload => {
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

  if (
    options.write &&
    error instanceof Error &&
    (error as { code?: unknown }).code === undefined &&
    error.message.length > 0 &&
    error.message.length < 300
  ) {
    return { code: "CONFLICT", message: error.message };
  }

  return { code: "INTERNAL", message: "Error interno de Workia." };
};

const resultFor = (payload: McpErrorPayload) =>
  payload.code === "FORBIDDEN_SCOPE" ||
  payload.code === "FORBIDDEN_RBAC" ||
  payload.code === "RATE_LIMITED" ||
  payload.code === "COMPANY_ACCESS_REVOKED" ||
  payload.code === "WRITES_DISABLED" ||
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
      tool.kind === "write" ? WRITE_CALLS_PER_MINUTE : READ_CALLS_PER_MINUTE,
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
    const toolContext: WorkiaToolContext = {
      auth,
      companyId: auth.companyId,
      userId: auth.userId,
      roleSlug: member.roleSlug,
      permissions: member.permissions,
      scopes,
      piiUnmasked,
      requestId,
      today: isoToday(now),
      origin: originFromContext(sdkContext),
    };
    const output =
      tool.kind === "write"
        ? await runWrite(tool, input, toolContext, now)
        : await tool.handler(input, toolContext);
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
    const payload = toErrorPayload(error, { write: tool.kind === "write" });

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

/**
 * The write path (spec §7): writes switched off → WRITES_DISABLED; no
 * confirmation token → a preview and a token, nothing written; a token for
 * other arguments or expired → CONFIRMATION_INVALID; the idempotency key
 * replays a finished write or refuses other arguments; the write runs in an
 * audit context so every event says source "mcp" and which connection acted.
 */
const runWrite = async (
  tool: WorkiaTool,
  input: Record<string, unknown>,
  ctx: WorkiaToolContext,
  now: Date,
): Promise<Record<string, unknown>> => {
  if (!tool.preview) {
    throw new McpToolError(
      "INTERNAL",
      "Herramienta de escritura sin vista previa.",
    );
  }

  if (!(await getMcpSettings(ctx.companyId)).writesEnabled) {
    throw new McpToolError(
      "WRITES_DISABLED",
      "Las escrituras por asistente están apagadas en esta empresa. Hazlo en la app de Workia o pide que las enciendan en Conexiones.",
    );
  }

  const {
    idempotency_key: idempotencyKey,
    confirmation_token: confirmationToken,
    ...args
  } = input as { idempotency_key: string; confirmation_token?: string };
  const hash = argsHash(input);
  const key = {
    connectionId: ctx.auth.connectionId,
    key: idempotencyKey,
    tool: tool.name,
    argsHash: hash,
  };
  const binding = {
    userId: ctx.userId,
    connectionId: ctx.auth.connectionId,
    tool: tool.name,
    argsHash: hash,
  };
  const mismatch = () =>
    new McpToolError(
      "IDEMPOTENCY_MISMATCH",
      "Esa idempotency_key ya se usó con otros datos. Usa una llave nueva para otra operación.",
    );

  if (!confirmationToken) {
    const prior = await findIdempotentReply(ctx.companyId, key, now);

    if (prior && "mismatch" in prior) throw mismatch();
    if (prior) return prior.response;

    const preview = await tool.preview(args, ctx);
    const confirmation = issueConfirmationToken(binding, now.getTime());

    return {
      status: "preview",
      code: "CONFIRMATION_REQUIRED",
      preview,
      confirmation_token: confirmation.token,
      expires_at: confirmation.expiresAt.toISOString(),
      expires_at_mx: formatDateTimeMx(confirmation.expiresAt),
    };
  }

  if (!verifyConfirmationToken(confirmationToken, binding, now.getTime())) {
    throw new McpToolError(
      "CONFIRMATION_INVALID",
      "El token de confirmación venció o es de otros datos. Pide la vista previa otra vez.",
    );
  }

  const reservation = await reserveIdempotencyKey(ctx.companyId, key, now);

  if (reservation.state === "mismatch") throw mismatch();
  if (reservation.state === "replay") return reservation.response;
  if (reservation.state === "pending") {
    throw new McpToolError(
      "CONFLICT",
      "Esta operación ya se está ejecutando con esa idempotency_key.",
    );
  }

  try {
    const { result, eventIds } = await runWithAuditContext(
      {
        source: "mcp",
        requestMeta: {
          path: "/api/mcp",
          method: "tools/call",
          client: ctx.auth.clientName,
          connection_id: ctx.auth.connectionId,
          tool: tool.name,
          request_id: ctx.requestId,
          idempotency_key: idempotencyKey,
        },
      },
      () => tool.handler(args, ctx),
    );
    const response = tool.output.parse({
      ...result,
      status: "done",
      audit_event_ids: eventIds,
    }) as Record<string, unknown>;

    await completeIdempotencyKey(ctx.companyId, reservation.id, response);

    return response;
  } catch (error) {
    await releaseIdempotencyKey(ctx.companyId, reservation.id);
    throw error;
  }
};
