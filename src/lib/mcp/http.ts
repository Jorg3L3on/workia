import { env } from "@/env";

import {
  isMcpEnabled,
  mcpResourceUrl,
  PROTECTED_RESOURCE_METADATA_PATH,
  publicOrigin,
} from "./config";
import { MCP_SCOPES } from "./scopes";

/**
 * Browser origins allowed to call /api/mcp. Server-to-server clients (Grok,
 * ChatGPT's backend, Cursor) send no Origin and are not affected. The MCP spec
 * asks servers to validate Origin against DNS rebinding.
 */
const DEFAULT_BROWSER_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
  "https://chat.openai.com",
];

const isLoopbackOrigin = (origin: string) => {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      (protocol === "http:" || protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    );
  } catch {
    return false;
  }
};

export const allowedOrigins = (request: Request) => [
  new URL(publicOrigin(request)).origin,
  new URL(request.url).origin,
  ...DEFAULT_BROWSER_ORIGINS,
  ...(env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

/** Null Origin (no header) is fine; a present one must be allowed. */
export const isAllowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  return allowedOrigins(request).includes(origin) || isLoopbackOrigin(origin);
};

const MCP_CORS_BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers":
    "mcp-session-id, mcp-protocol-version, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

/** CORS for /api/mcp: echoes an allowed Origin (never "*", tokens are per user). */
export const mcpCorsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get("origin");

  return origin && isAllowedOrigin(request)
    ? { ...MCP_CORS_BASE, "Access-Control-Allow-Origin": origin }
    : { ...MCP_CORS_BASE };
};

export const withHeaders = (
  response: Response,
  headers: Record<string, string>,
) => {
  const merged = new Headers(response.headers);

  for (const [key, value] of Object.entries(headers)) {
    merged.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
};

export const forbiddenOriginResponse = () =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32600, message: "Origin not allowed" },
      id: null,
    },
    { status: 403 },
  );

export const mcpDisabledResponse = () =>
  Response.json(
    { error: "not_found", error_description: "MCP deshabilitado" },
    { status: 404 },
  );

// ---------------------------------------------------------------------------
// OAuth responses (public endpoints: any origin, no credentials)
// ---------------------------------------------------------------------------

const OAUTH_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export const oauthJson = (
  body: unknown,
  init: ResponseInit & { cache?: string } = {},
) => {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", init.cache ?? "no-store");

  for (const [key, value] of Object.entries(OAUTH_CORS)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(body), { status: init.status, headers });
};

export const oauthError = (error: string, description?: string, status = 400) =>
  oauthJson(
    { error, ...(description ? { error_description: description } : {}) },
    { status },
  );

export const oauthOptions = () =>
  new Response(null, { status: 204, headers: OAUTH_CORS });

/** Wraps a public OAuth/discovery handler: 404 while MCP_ENABLED is off. */
export const whenEnabled =
  <A extends unknown[]>(
    handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  ) =>
  async (request: Request, ...rest: A) =>
    isMcpEnabled() ? handler(request, ...rest) : mcpDisabledResponse();

// ---------------------------------------------------------------------------
// Discovery metadata
// ---------------------------------------------------------------------------

/** RFC 9728 protected resource metadata. */
export const protectedResourceMetadata = (request: Request) => {
  const issuer = publicOrigin(request);

  return {
    resource: mcpResourceUrl(request),
    resource_name: "Workia",
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/app/conexiones`,
  };
};

/** RFC 8414 authorization server metadata. */
export const authorizationServerMetadata = (request: Request) => {
  const issuer = publicOrigin(request);

  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "private_key_jwt",
      "client_secret_post",
    ],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/app/conexiones`,
  };
};

export const resourceMetadataUrl = (request: Request) =>
  `${publicOrigin(request)}${PROTECTED_RESOURCE_METADATA_PATH}`;
