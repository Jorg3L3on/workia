import { z } from "zod";

import {
  isOwnResource,
  normalizeResource,
  TOKEN_ATTEMPTS_PER_MINUTE,
} from "@/lib/mcp/config";
import {
  exchangeAuthCode,
  InvalidGrantError,
  refreshConnection,
} from "@/lib/mcp/connections";
import {
  oauthError,
  oauthJson,
  oauthOptions,
  whenEnabled,
} from "@/lib/mcp/http";
import {
  authenticateClient,
  isChatgptClient,
  isRegisteredRedirectUri,
  resolveClient,
} from "@/lib/mcp/oauth/clients";
import { clientIp, hitRateLimit } from "@/lib/mcp/rate-limit";
import { isValidPkceVerifier } from "@/lib/mcp/tokens";
import { logger } from "@/lib/logger";

const codeGrant = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional(),
  resource: z.string().url().optional(),
});

const refreshGrant = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  resource: z.string().url().optional(),
});

const tokenRequest = z.discriminatedUnion("grant_type", [
  codeGrant,
  refreshGrant,
]);

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const type = request.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }

  return Object.fromEntries((await request.formData()).entries());
};

/** Host of a CIMD client_id, or "dcr": enough to debug, nothing secret. */
const clientLabel = (clientId: unknown) => {
  try {
    return new URL(String(clientId)).host;
  } catch {
    return "dcr";
  }
};

// Token endpoint: authorization_code (PKCE S256) and refresh_token (rotating).
// 30 attempts per minute per IP; attempts are logged without codes or tokens.
export const POST = whenEnabled(async (request) => {
  const limit = await hitRateLimit(
    `oauth:token:${clientIp(request)}`,
    TOKEN_ATTEMPTS_PER_MINUTE,
    60 * 1000,
  );

  if (limit.limited) {
    return oauthJson(
      { error: "slow_down", error_description: "Demasiados intentos." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let grantType = "unknown";
  let clientId: unknown = null;
  const sameResource = (a: string, b: string) =>
    normalizeResource(a, request) === normalizeResource(b, request);
  const outcome = (result: string) =>
    logger.info(
      {
        event: "mcp.oauth.token",
        grantType,
        client: clientLabel(clientId),
        result,
      },
      "mcp.oauth.token",
    );

  try {
    const body = await readBody(request);
    grantType = String(body.grant_type ?? "unknown");
    clientId = body.client_id;

    const parsed = tokenRequest.safeParse(body);

    if (!parsed.success) {
      outcome("invalid_request");
      return grantType === "authorization_code" || grantType === "refresh_token"
        ? oauthError("invalid_request", "Solicitud incompleta.")
        : oauthError("unsupported_grant_type");
    }

    const input = parsed.data;
    const client = await resolveClient(input.client_id);

    if (!client || !authenticateClient(client, input.client_secret)) {
      outcome("invalid_client");
      return oauthError("invalid_client", undefined, 401);
    }

    if (input.resource && !isOwnResource(input.resource, request)) {
      outcome("invalid_target");
      return oauthError("invalid_target");
    }

    if (input.grant_type === "authorization_code") {
      if (!isValidPkceVerifier(input.code_verifier)) {
        outcome("invalid_request");
        return oauthError(
          "invalid_request",
          "code_verifier (PKCE S256) requerido.",
        );
      }

      if (!isRegisteredRedirectUri(client, input.redirect_uri)) {
        outcome("invalid_grant");
        return oauthError("invalid_grant");
      }

      const tokens = await exchangeAuthCode({
        code: input.code,
        clientId: client.clientId,
        clientName: client.clientName,
        isChatgpt: isChatgptClient(client),
        redirectUri: input.redirect_uri,
        codeVerifier: input.code_verifier,
        resource: input.resource ?? null,
        sameResource,
      });

      outcome("ok");
      return oauthJson(tokens);
    }

    const tokens = await refreshConnection({
      refreshToken: input.refresh_token,
      clientId: client.clientId,
      resource: input.resource ?? null,
      sameResource,
    });

    outcome("ok");
    return oauthJson(tokens);
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      outcome(`invalid_grant:${error.reason}`);
      return oauthError("invalid_grant");
    }

    if (error instanceof SyntaxError) {
      outcome("invalid_request");
      return oauthError("invalid_request", "Cuerpo inválido.");
    }

    outcome("server_error");
    throw error;
  }
});

export const OPTIONS = whenEnabled(() => oauthOptions());
