/**
 * Business errors of the connector come back as a tool result, not a protocol
 * error: `isError: true` with `structuredContent.error` and stable codes the
 * assistant can act on (spec §7).
 */
export const MCP_ERROR_CODES = [
  "UNAUTHENTICATED",
  "COMPANY_ACCESS_REVOKED",
  "FORBIDDEN_SCOPE",
  "FORBIDDEN_RBAC",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "CONFIRMATION_INVALID",
  "IDEMPOTENCY_MISMATCH",
  "WRITES_DISABLED",
  "INTERNAL",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export type McpErrorPayload = {
  code: McpErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retry_after_s?: number;
};

export class McpToolError extends Error {
  readonly code: McpErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: McpErrorCode,
    message: string,
    options: {
      details?: Record<string, unknown>;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  toPayload(): McpErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.retryAfterSeconds !== undefined
        ? { retry_after_s: this.retryAfterSeconds }
        : {}),
    };
  }
}

export const notFound = (what = "El registro") =>
  new McpToolError("NOT_FOUND", `${what} no existe o no está disponible.`);

export type ToolErrorResult = {
  isError: true;
  content: [{ type: "text"; text: string }];
  structuredContent: { error: McpErrorPayload };
};

export const toolErrorResult = (payload: McpErrorPayload): ToolErrorResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: payload }) }],
  structuredContent: { error: payload },
});
