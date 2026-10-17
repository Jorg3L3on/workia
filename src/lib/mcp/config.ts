import { env } from "@/env";

/** Where the connector lives and its resource identifier (RFC 8707) path. */
export const MCP_RESOURCE_PATH = "/api/mcp";
/** Some clients (ChatGPT) try origin + /mcp first; it names the same resource. */
export const MCP_RESOURCE_ALIAS_PATH = "/mcp";
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

export const MCP_SERVER_NAME = "workia";
export const MCP_SERVER_VERSION = "1.0.0";

/** Token lifetimes (spec §6). */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
/** A personal token always expires; these are the choices. */
export const PAT_EXPIRY_DAYS = [7, 30, 90] as const;
export type PatExpiryDays = (typeof PAT_EXPIRY_DAYS)[number];

/** Rate limits (spec §7). */
export const READ_CALLS_PER_MINUTE = 120;
export const NEW_CONNECTIONS_PER_HOUR = 10;
export const TOKEN_ATTEMPTS_PER_MINUTE = 30;

/** mcp_tool_calls retention (D-13). */
export const TOOL_CALL_RETENTION_MONTHS = 12;

/** The endpoint, OAuth and discovery answer only when this is on (default on). */
export const isMcpEnabled = () => {
  const value = env.MCP_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
};

const trimSlash = (value: string) => value.replace(/\/+$/, "");

/** The OAuth issuer and public origin: MCP_PUBLIC_URL, else the request's origin. */
export const publicOrigin = (request?: Request) => {
  if (env.MCP_PUBLIC_URL) {
    return trimSlash(env.MCP_PUBLIC_URL);
  }

  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const url = new URL(request.url);

    if (forwardedHost) {
      const proto =
        request.headers.get("x-forwarded-proto") ??
        url.protocol.replace(":", "");
      return `${proto}://${forwardedHost}`;
    }

    return url.origin;
  }

  return "http://localhost:3000";
};

export const mcpResourceUrl = (request?: Request) =>
  `${publicOrigin(request)}${MCP_RESOURCE_PATH}`;

/** Canonical resource for storage: same-origin /mcp and /api/mcp are one resource. */
export const normalizeResource = (resource: string, request?: Request) => {
  try {
    const url = new URL(resource);
    const origin = new URL(publicOrigin(request)).origin;
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (
      url.origin === origin &&
      (path === MCP_RESOURCE_PATH || path === MCP_RESOURCE_ALIAS_PATH)
    ) {
      return `${origin}${MCP_RESOURCE_PATH}`;
    }

    return resource;
  } catch {
    return resource;
  }
};

/** Whether a requested resource is this connector. */
export const isOwnResource = (resource: string, request?: Request) =>
  normalizeResource(resource, request) === mcpResourceUrl(request);
