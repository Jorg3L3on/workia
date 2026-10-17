import {
  isOwnResource,
  mcpResourceUrl,
  normalizeResource,
} from "@/lib/mcp/config";
import { oauthError, oauthOptions, whenEnabled } from "@/lib/mcp/http";
import {
  isRegisteredRedirectUri,
  resolveClient,
} from "@/lib/mcp/oauth/clients";
import { publicOrigin } from "@/lib/mcp/config";

const REQUIRED = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
] as const;

/** Sends an OAuth error back to the client's redirect URI (RFC 6749 §4.1.2.1). */
const redirectError = (
  request: Request,
  redirectUri: string,
  error: string,
  state: string | null,
) => {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("iss", publicOrigin(request));
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url, 302);
};

// Authorization endpoint: checks the client and redirect URI, then hands off to
// /oauth/consent, which requires a Workia session (login first) and asks the
// person to pick the company and the scopes.
export const GET = whenEnabled(async (request) => {
  const params = new URL(request.url).searchParams;
  const missing = REQUIRED.filter((name) => !params.get(name));

  if (missing.length > 0) {
    return oauthError(
      "invalid_request",
      `Faltan parámetros: ${missing.join(", ")}`,
    );
  }

  const client = await resolveClient(params.get("client_id")!);

  if (!client) {
    return oauthError("invalid_client", "Cliente OAuth desconocido.", 401);
  }

  const redirectUri = params.get("redirect_uri")!;

  if (!isRegisteredRedirectUri(client, redirectUri)) {
    return oauthError(
      "invalid_request",
      "redirect_uri no registrada para este cliente.",
    );
  }

  const state = params.get("state");

  if (params.get("response_type") !== "code") {
    return redirectError(
      request,
      redirectUri,
      "unsupported_response_type",
      state,
    );
  }

  if (params.get("code_challenge_method") !== "S256") {
    return redirectError(request, redirectUri, "invalid_request", state);
  }

  const resource = params.get("resource") ?? mcpResourceUrl(request);

  if (!isOwnResource(resource, request)) {
    return redirectError(request, redirectUri, "invalid_target", state);
  }

  const consent = new URL("/oauth/consent", publicOrigin(request));

  for (const [key, value] of params.entries()) {
    consent.searchParams.set(key, value);
  }

  consent.searchParams.set("resource", normalizeResource(resource, request));

  return Response.redirect(consent, 302);
});

export const OPTIONS = whenEnabled(() => oauthOptions());
