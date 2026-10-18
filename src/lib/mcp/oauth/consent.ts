import type { McpClient } from "@/lib/db/schema";
import {
  combinePermissions,
  getRolePermissionSlugs,
  listActiveMemberships,
  type ActiveMembership,
} from "@/lib/tenant/memberships";

import { isOwnResource, mcpResourceUrl, normalizeResource } from "../config";
import {
  applyClientCeiling,
  grantableScopes,
  parseScopeParam,
  type McpScope,
} from "../scopes";
import {
  isChatgptClient,
  isRegisteredRedirectUri,
  resolveClient,
} from "./clients";

/** The OAuth parameters /oauth/consent carries from /api/oauth/authorize. */
export const CONSENT_PARAMS = [
  "client_id",
  "redirect_uri",
  "state",
  "scope",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export type ConsentParams = Partial<
  Record<(typeof CONSENT_PARAMS)[number], string>
>;

export type ConsentCompany = {
  membership: ActiveMembership;
  /** Can connect assistants here (mcp_connections:create). */
  canConnect: boolean;
  /** Scopes this person may grant this client in this company. */
  offerable: McpScope[];
};

export type ConsentRequest = {
  client: McpClient;
  isChatgpt: boolean;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  requested: McpScope[];
  companies: ConsentCompany[];
};

export type ConsentLoad =
  { ok: true; request: ConsentRequest } | { ok: false; error: string };

/**
 * Validates the consent parameters again (the page can be opened by hand) and
 * works out, per company the person belongs to, the scopes they may grant:
 * their role there ∩ the client's ceiling (ChatGPT: read, audit; pii only for
 * a super_admin; never write:*).
 */
export const loadConsentRequest = async (
  params: ConsentParams,
  userId: string,
  request?: Request,
): Promise<ConsentLoad> => {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const codeChallenge = params.code_challenge;

  if (!clientId || !redirectUri || !codeChallenge) {
    return { ok: false, error: "Faltan datos de la solicitud de conexión." };
  }

  if (params.code_challenge_method !== "S256") {
    return { ok: false, error: "La solicitud no usa PKCE S256." };
  }

  const client = await resolveClient(clientId);

  if (!client || !isRegisteredRedirectUri(client, redirectUri)) {
    return {
      ok: false,
      error: "El cliente o su dirección de retorno no son válidos.",
    };
  }

  const resource = normalizeResource(
    params.resource ?? mcpResourceUrl(request),
    request,
  );

  if (!isOwnResource(resource, request)) {
    return { ok: false, error: "La solicitud es para otro recurso." };
  }

  const isChatgpt = isChatgptClient(client);
  const memberships = await listActiveMemberships(userId);
  const companies = await Promise.all(
    memberships.map(async (membership) => {
      // Never platform permissions over MCP (addendum §2).
      const permissions = combinePermissions(
        await getRolePermissionSlugs(membership.roleId),
        false,
      );

      return {
        membership,
        canConnect: permissions.has("mcp_connections:create"),
        offerable: applyClientCeiling(grantableScopes(permissions), {
          isChatgpt,
          allowChatgptPii: membership.roleSlug === "super_admin",
        }),
      };
    }),
  );

  return {
    ok: true,
    request: {
      client,
      isChatgpt,
      redirectUri,
      state: params.state ?? null,
      codeChallenge,
      resource,
      requested: parseScopeParam(params.scope),
      companies,
    },
  };
};

/** Final scopes: what the person ticked ∩ what they may grant there; read always. */
export const resolveGrantedScopes = (
  selected: readonly string[],
  company: ConsentCompany,
  requested: readonly McpScope[],
): McpScope[] => {
  const offerable = new Set(company.offerable);
  const scopes = new Set<McpScope>(["read"]);

  for (const scope of selected) {
    if (offerable.has(scope as McpScope)) {
      scopes.add(scope as McpScope);
    }
  }

  // offline_access is not a data scope: kept when the client asked for it.
  if (requested.includes("offline_access") && offerable.has("offline_access")) {
    scopes.add("offline_access");
  }

  return [...scopes];
};

/** The client's redirect URI with the code (or error), state and iss (RFC 9207). */
export const callbackUrl = (
  redirectUri: string,
  issuer: string,
  values: Record<string, string | null>,
) => {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
  }

  url.searchParams.set("iss", issuer);
  return url.toString();
};
