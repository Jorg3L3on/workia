import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import {
  isMcpEnabled,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  PROTECTED_RESOURCE_METADATA_PATH,
  publicOrigin,
} from "@/lib/mcp/config";
import { verifyBearerToken } from "@/lib/mcp/connections";
import {
  forbiddenOriginResponse,
  isAllowedOrigin,
  mcpCorsHeaders,
  mcpDisabledResponse,
  withHeaders,
} from "@/lib/mcp/http";
import { MCP_INSTRUCTIONS, registerWorkiaTools } from "@/lib/mcp/server";

// Stateless Streamable HTTP (spec §5): every request builds its server, answers
// and ends. Node runtime (AsyncLocalStorage, pg) and a short ceiling.
export const runtime = "nodejs";
export const maxDuration = 30;

const mcpHandler = createMcpHandler(registerWorkiaTools, {
  serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
  instructions: MCP_INSTRUCTIONS,
});

/** Bearer → connection. AuthInfo.extra.workia rides to runWorkiaTool. */
const verifyToken = async (
  _request: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) {
    return undefined;
  }

  const auth = await verifyBearerToken(bearerToken);

  if (!auth) {
    return undefined;
  }

  return {
    token: bearerToken,
    clientId: auth.clientId ?? `pat:${auth.connectionId}`,
    scopes: auth.scopes,
    expiresAt: Math.floor(auth.expiresAt.getTime() / 1000),
    extra: { workia: auth },
  };
};

const handle = async (request: Request) => {
  if (!isMcpEnabled()) {
    return mcpDisabledResponse();
  }

  if (!isAllowedOrigin(request)) {
    return forbiddenOriginResponse();
  }

  // 401 + WWW-Authenticate (resource_metadata) without a valid token; 403
  // insufficient_scope when the token lacks read (RFC 9728, RFC 6750).
  const authenticated = withMcpAuth(mcpHandler, verifyToken, {
    required: true,
    requiredScopes: ["read"],
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
    resourceUrl: publicOrigin(request),
  });

  return withHeaders(await authenticated(request), mcpCorsHeaders(request));
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export const OPTIONS = async (request: Request) => {
  if (!isMcpEnabled()) {
    return mcpDisabledResponse();
  }

  if (!isAllowedOrigin(request)) {
    return forbiddenOriginResponse();
  }

  return new Response(null, { status: 204, headers: mcpCorsHeaders(request) });
};
