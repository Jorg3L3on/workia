/**
 * Workia MCP connector (WRK-I1): OAuth and personal tokens against a real
 * database, cross-company isolation of connections, and the endpoint itself.
 * Test titles are the surface ids of docs/idor-matrix.md.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" }),
  cookies: async () => ({ get: () => undefined }),
}));

import {
  POST as mcpPost,
  GET as mcpGet,
  DELETE as mcpDelete,
} from "@/app/api/mcp/route";
import { GET as authorizeGet } from "@/app/api/oauth/authorize/route";
import { POST as registerPost } from "@/app/api/oauth/register/route";
import { POST as revokePost } from "@/app/api/oauth/revoke/route";
import { POST as tokenPost } from "@/app/api/oauth/token/route";
import { GET as authServerGet } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";
import { GET as resourceGet } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import {
  companyMemberships,
  mcpAuthCodes,
  mcpClients,
  mcpConnections,
  mcpToolCalls,
  roles,
} from "@/lib/db/schema";
import {
  createPersonalTokenAction,
  hideConnectionAction,
  revokeConnectionAction,
} from "@/lib/mcp/actions";
import {
  countRecentConnections,
  countToolCallErrors,
  createAuthCode,
  createPersonalToken,
  getConnection,
  hideConnection,
  listConnections,
  listToolCalls,
  purgeExpiredToolCalls,
  recordToolCall,
  revokeConnection,
  verifyBearerToken,
} from "@/lib/mcp/connections";
import {
  approveConsentAction,
  denyConsentAction,
} from "@/lib/mcp/oauth/consent-actions";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const ORIGIN = "http://localhost:3000";
const REDIRECT = "https://cliente.example/callback";

let a: Tenant;
let b: Tenant;

const form = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value])
      data.append(key, item);
  }
  return data;
};

const navigationUrl = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { url?: string }).url ?? null;
  }
};

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

const registerDcrClient = async (redirectUris = [REDIRECT]) => {
  const response = await registerPost(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}`,
      },
      body: JSON.stringify({
        client_name: "Grok Bot",
        redirect_uris: redirectUris,
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string };
};

const token = (body: Record<string, string>) =>
  tokenPost(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": `10.1.${Math.floor(Math.random() * 200)}.1`,
      },
      body: new URLSearchParams(body),
    }),
  );

const rpc = (bearer: string | null, body: unknown) =>
  mcpPost(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const readRpc = async (response: Response) => {
  const text = await response.text();
  const json = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
  return JSON.parse(json);
};

const callTool = async (
  bearer: string,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const response = await rpc(bearer, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return {
    status: response.status,
    body: response.status === 200 ? await readRpc(response) : null,
  };
};

/** A full authorization-code flow as `user` of `tenant`; returns the token response. */
const oauthFlow = async (
  tenant: Tenant,
  user: { id: string; email: string },
  options: { clientId?: string; scope?: string; choices?: string[] } = {},
) => {
  const clientId = options.clientId ?? (await registerDcrClient()).client_id;
  const { verifier, challenge } = pkce();
  const params = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    scope: options.scope ?? "read offline_access",
    resource: `${ORIGIN}/api/mcp`,
  };

  const authorize = await authorizeGet(
    new Request(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams(params)}`),
  );
  expect(authorize.status).toBe(302);
  expect(new URL(authorize.headers.get("location")!).pathname).toBe(
    "/oauth/consent",
  );

  actAs(user, tenant.companyId);
  const consentParams = { ...params } as Record<string, string>;
  delete consentParams.response_type;
  const callback = await navigationUrl(() =>
    approveConsentAction(
      {},
      form({
        ...consentParams,
        company_id: tenant.companyId,
        scope_choice: options.choices ?? [],
      }),
    ),
  );
  expect(callback).toBeTruthy();
  const url = new URL(callback!);
  expect(url.searchParams.get("state")).toBe("xyz");
  expect(url.searchParams.get("iss")).toBe(ORIGIN);

  const response = await token({
    grant_type: "authorization_code",
    code: url.searchParams.get("code")!,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
    resource: `${ORIGIN}/api/mcp`,
  });
  expect(response.status).toBe(200);
  return {
    clientId,
    tokens: (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    },
  };
};

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("discovery", () => {
  it("route:GET /.well-known/oauth-protected-resource/[[...path]]", async () => {
    const response = await resourceGet(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`),
    );
    const body = await response.json();

    expect(body.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(body.authorization_servers).toEqual([ORIGIN]);
    expect(body.scopes_supported).toContain("offline_access");
  });

  it("route:GET /.well-known/oauth-authorization-server/[[...path]]", async () => {
    const body = await (
      await authServerGet(
        new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      )
    ).json();

    expect(body).toMatchObject({
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: [
        "none",
        "private_key_jwt",
        "client_secret_post",
      ],
    });
    expect(body.scopes_supported).toContain("offline_access");
  });
});

describe("OAuth: code, tokens, rotation", () => {
  it("route:POST /api/oauth/register", async () => {
    const { client_id } = await registerDcrClient();
    const [row] = await ownerDb
      .select()
      .from(mcpClients)
      .where(eq(mcpClients.clientId, client_id));

    expect(row).toMatchObject({
      registration: "dcr",
      redirectUris: [REDIRECT],
    });
  });

  it("route:GET /api/oauth/authorize", async () => {
    const { client_id } = await registerDcrClient();
    const bad = await authorizeGet(
      new Request(
        `${ORIGIN}/api/oauth/authorize?${new URLSearchParams({
          client_id,
          redirect_uri: "https://atacante.example/cb",
          response_type: "code",
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
        })}`,
      ),
    );

    // An unregistered redirect URI is never redirected to.
    expect(bad.status).toBe(400);
  });

  it("route:POST /api/oauth/token", async () => {
    const { tokens } = await oauthFlow(a, a.admin);

    expect(tokens.access_token.startsWith("workia_at_")).toBe(true);
    expect(tokens.refresh_token.startsWith("workia_rt_")).toBe(true);
    expect(tokens.expires_in).toBe(3600);

    const [row] = await ownerDb
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.tokenPrefix, tokens.access_token.slice(0, 22)));

    expect(row.companyId).toBe(a.companyId);
    expect(row.kind).toBe("oauth");
    // 30-day refresh window.
    const days = (row.refreshExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    // Only a prefix and a hash are stored.
    expect(JSON.stringify(row)).not.toContain(tokens.access_token);
    expect(JSON.stringify(row)).not.toContain(tokens.refresh_token);
  });

  it("redeems a code once and refuses a wrong PKCE verifier", async () => {
    const { client_id } = await registerDcrClient();
    const { challenge } = pkce();
    const code = await createAuthCode(a.companyId, {
      userId: a.admin.id,
      clientId: client_id,
      redirectUri: REDIRECT,
      scopes: ["read"],
      codeChallenge: challenge,
      resource: `${ORIGIN}/api/mcp`,
    });
    const attempt = () =>
      token({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id,
        code_verifier: pkce().verifier,
      });

    expect((await (await attempt()).json()).error).toBe("invalid_grant");
    // The failed attempt consumed it: no second chance.
    expect((await (await attempt()).json()).error).toBe("invalid_grant");
  });

  it("rotates the refresh token and revokes the family when an old one is reused", async () => {
    const { clientId, tokens } = await oauthFlow(a, a.admin);
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    const next = await refreshed.json();

    expect(refreshed.status).toBe(200);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await verifyBearerToken(tokens.access_token)).toBeNull();
    expect(await verifyBearerToken(next.access_token)).not.toBeNull();

    // Reusing the rotated refresh token is theft: the connection dies.
    const reuse = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect((await reuse.json()).error).toBe("invalid_grant");
    expect(await verifyBearerToken(next.access_token)).toBeNull();

    const [row] = await ownerDb
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.tokenPrefix, next.access_token.slice(0, 22)));
    expect(row.revokedReason).toBe("refresh_reuse");
  });

  it("caps ChatGPT at read (+audit) even when the code asks for more", async () => {
    const chatgptRedirect =
      "https://chatgpt.com/connector_platform_oauth_redirect";
    const { client_id } = await registerDcrClient([chatgptRedirect]);
    const { verifier, challenge } = pkce();
    const code = await createAuthCode(a.companyId, {
      userId: a.admin.id,
      clientId: client_id,
      redirectUri: chatgptRedirect,
      scopes: ["read", "audit", "pii", "write:assets", "write:people"],
      codeChallenge: challenge,
      resource: `${ORIGIN}/api/mcp`,
    });
    const response = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: chatgptRedirect,
      client_id,
      code_verifier: verifier,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scope.split(" ").sort()).toEqual(["audit", "read"]);

    const auth = await verifyBearerToken(body.access_token);
    expect(auth?.isChatgpt).toBe(true);

    const whoami = await callTool(body.access_token, "whoami");
    expect(whoami.body.result.structuredContent.scopes.sort()).toEqual([
      "audit",
      "read",
    ]);
    expect(whoami.body.result.structuredContent.connection.is_chatgpt).toBe(
      true,
    );
  });

  it("route:POST /api/oauth/revoke", async () => {
    const { tokens } = await oauthFlow(b, b.admin);

    expect(await verifyBearerToken(tokens.access_token)).not.toBeNull();
    const response = await revokePost(
      new Request(`${ORIGIN}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refresh_token }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await verifyBearerToken(tokens.access_token)).toBeNull();
  });
});

describe("consent", () => {
  it("action:mcp/approveConsentAction", async () => {
    const { client_id } = await registerDcrClient();
    const params = {
      client_id,
      redirect_uri: REDIRECT,
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      scope: "read",
    };

    // Company B's admin asks for a code in company A: refused, nothing stored.
    actAs(b.admin, b.companyId);
    const result = await approveConsentAction(
      {},
      form({ ...params, company_id: a.companyId }),
    );
    expect(result.error).toBeTruthy();
    const codes = await ownerDb
      .select()
      .from(mcpAuthCodes)
      .where(and(eq(mcpAuthCodes.clientId, client_id)));
    expect(codes).toHaveLength(0);
  });

  it("rbac:action:mcp/approveConsentAction", async () => {
    const { client_id } = await registerDcrClient();

    // A viewer has no mcp_connections:create.
    actAs(a.viewer, a.companyId);
    const result = await approveConsentAction(
      {},
      form({
        client_id,
        redirect_uri: REDIRECT,
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
        company_id: a.companyId,
      }),
    );
    expect(result.error).toBeTruthy();
  });

  it("drops scopes the role cannot grant (an editor gets pii, never audit)", async () => {
    const [editorRole] = await ownerDb
      .select()
      .from(roles)
      .where(eq(roles.slug, "editor"));
    await ownerDb
      .update(companyMemberships)
      .set({ roleId: editorRole.id })
      .where(eq(companyMemberships.id, a.viewer.membershipId));

    try {
      const { tokens } = await oauthFlow(a, a.viewer, {
        scope: "read audit pii write:catalog",
        choices: ["audit", "pii", "write:catalog", "write:assets"],
      });

      expect(tokens.scope.split(" ").sort()).toEqual([
        "pii",
        "read",
        "write:assets",
      ]);
    } finally {
      const [viewerRole] = await ownerDb
        .select()
        .from(roles)
        .where(eq(roles.slug, "viewer"));
      await ownerDb
        .update(companyMemberships)
        .set({ roleId: viewerRole.id })
        .where(eq(companyMemberships.id, a.viewer.membershipId));
    }
  });

  it("action:mcp/denyConsentAction", async () => {
    const { client_id } = await registerDcrClient();
    actAs(b.admin, b.companyId);
    const url = await navigationUrl(() =>
      denyConsentAction(
        form({
          client_id,
          redirect_uri: REDIRECT,
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
          state: "s1",
        }),
      ),
    );

    expect(new URL(url!).searchParams.get("error")).toBe("access_denied");
    expect(new URL(url!).searchParams.get("state")).toBe("s1");
  });
});

describe("personal tokens and the connections screen", () => {
  let aConnectionId: string;

  it("action:mcp/createPersonalTokenAction", async () => {
    actAs(a.admin, a.companyId);
    const created = await createPersonalTokenAction(
      {},
      form({
        companyId: a.companyId,
        name: "Grok A",
        preset: "grok_lectura",
        expiresInDays: "30",
      }),
    );

    expect(created.token?.startsWith("workia_pat_")).toBe(true);
    expect(created.scopes?.sort()).toEqual(["audit", "read"]);

    const [row] = await ownerDb
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.tokenPrefix, created.token!.slice(0, 23)));
    aConnectionId = row.id;
    expect(row.companyId).toBe(a.companyId);
    expect(row.tokenHash).toBe(
      createHash("sha256").update(created.token!).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(created.token);

    // A form opened in company A cannot create in company B.
    actAs(b.admin, b.companyId);
    const stale = await createPersonalTokenAction(
      {},
      form({
        companyId: a.companyId,
        name: "Cruzado",
        preset: "solo_lectura",
        expiresInDays: "7",
      }),
    );
    expect(stale.token).toBeUndefined();
  });

  it("rbac:action:mcp/createPersonalTokenAction", async () => {
    actAs(a.viewer, a.companyId);
    const denied = await createPersonalTokenAction(
      {},
      form({
        companyId: a.companyId,
        name: "Viewer",
        preset: "solo_lectura",
        expiresInDays: "7",
      }),
    );

    expect(denied.error).toBeTruthy();
    expect(denied.token).toBeUndefined();
  });

  it("requires an expiry of 7, 30 or 90 days", async () => {
    actAs(a.admin, a.companyId);
    const result = await createPersonalTokenAction(
      {},
      form({
        companyId: a.companyId,
        name: "Eterno",
        preset: "solo_lectura",
        expiresInDays: "365",
      }),
    );

    expect(result.token).toBeUndefined();
    expect(result.error).toMatch(/7, 30 o 90/);
  });

  it("action:mcp/revokeConnectionAction", async () => {
    actAs(b.admin, b.companyId);
    const result = await revokeConnectionAction(
      {},
      form({ companyId: b.companyId, connectionId: aConnectionId }),
    );

    expect(result.error).toBeTruthy();
    expect(
      (await getConnection(a.companyId, aConnectionId))?.revokedAt,
    ).toBeNull();
  });

  it("rbac:action:mcp/revokeConnectionAction", async () => {
    // The viewer can neither create nor manage: someone else's connection is off limits.
    actAs(a.viewer, a.companyId);
    const result = await revokeConnectionAction(
      {},
      form({ companyId: a.companyId, connectionId: aConnectionId }),
    );

    expect(result.error).toBeTruthy();
    expect(
      (await getConnection(a.companyId, aConnectionId))?.revokedAt,
    ).toBeNull();
  });

  it("action:mcp/hideConnectionAction", async () => {
    actAs(b.admin, b.companyId);
    const result = await hideConnectionAction(
      {},
      form({ companyId: b.companyId, connectionId: aConnectionId }),
    );

    expect(result.error).toBeTruthy();
    expect(
      (await getConnection(a.companyId, aConnectionId))?.hiddenAt,
    ).toBeNull();
  });

  it("rbac:action:mcp/hideConnectionAction", async () => {
    actAs(a.viewer, a.companyId);
    const result = await hideConnectionAction(
      {},
      form({ companyId: a.companyId, connectionId: aConnectionId }),
    );

    expect(result.error).toBeTruthy();
  });

  it("revoking in the app cuts access on the next call; then it can be hidden", async () => {
    actAs(a.admin, a.companyId);
    const created = await createPersonalTokenAction(
      {},
      form({
        companyId: a.companyId,
        name: "Para revocar",
        preset: "solo_lectura",
        expiresInDays: "7",
      }),
    );
    expect((await callTool(created.token!, "whoami")).status).toBe(200);

    const [row] = await ownerDb
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.tokenPrefix, created.token!.slice(0, 23)));
    const hideFirst = await hideConnectionAction(
      {},
      form({ companyId: a.companyId, connectionId: row.id }),
    );
    expect(hideFirst.error).toMatch(/Revoca/);

    expect(
      await revokeConnectionAction(
        {},
        form({ companyId: a.companyId, connectionId: row.id }),
      ),
    ).toEqual({ ok: true });
    expect((await callTool(created.token!, "whoami")).status).toBe(401);
    expect(
      await hideConnectionAction(
        {},
        form({ companyId: a.companyId, connectionId: row.id }),
      ),
    ).toEqual({ ok: true });
    expect(
      (await listConnections(a.companyId)).map((item) => item.id),
    ).not.toContain(row.id);
  });

  it("lib:mcp/connections/createPersonalToken", async () => {
    // B's admin has no membership in A.
    await expect(
      createPersonalToken(a.companyId, {
        userId: b.admin.id,
        name: "Cruzado",
        scopes: ["read"],
        expiresInDays: 7,
      }),
    ).rejects.toThrow();
  });

  it("lib:mcp/connections/createAuthCode", async () => {
    const { client_id } = await registerDcrClient();
    await createAuthCode(b.companyId, {
      userId: b.admin.id,
      clientId: client_id,
      redirectUri: REDIRECT,
      scopes: ["read"],
      codeChallenge: pkce().challenge,
      resource: `${ORIGIN}/api/mcp`,
    });
    const [row] = await ownerDb
      .select()
      .from(mcpAuthCodes)
      .where(eq(mcpAuthCodes.clientId, client_id));

    expect(row.companyId).toBe(b.companyId);
  });

  it("lib:mcp/connections/getConnection", async () => {
    expect(await getConnection(b.companyId, aConnectionId)).toBeNull();
    expect(await getConnection(a.companyId, aConnectionId)).not.toBeNull();
  });

  it("lib:mcp/connections/listConnections", async () => {
    const ids = (await listConnections(b.companyId)).map((item) => item.id);
    expect(ids).not.toContain(aConnectionId);
  });

  it("lib:mcp/connections/revokeConnection", async () => {
    expect(
      await revokeConnection(b.companyId, aConnectionId, {
        userId: b.admin.id,
        reason: "x",
      }),
    ).toBeNull();
    expect(
      (await getConnection(a.companyId, aConnectionId))?.revokedAt,
    ).toBeNull();
  });

  it("lib:mcp/connections/hideConnection", async () => {
    expect(await hideConnection(b.companyId, aConnectionId)).toBeNull();
    expect(
      (await getConnection(a.companyId, aConnectionId))?.hiddenAt,
    ).toBeNull();
  });

  it("lib:mcp/connections/countRecentConnections", async () => {
    const since = new Date(Date.now() - 3_600_000);
    expect(await countRecentConnections(b.companyId, a.admin.id, since)).toBe(
      0,
    );
    expect(
      await countRecentConnections(a.companyId, a.admin.id, since),
    ).toBeGreaterThan(0);
  });

  it("lib:mcp/connections/listToolCalls", async () => {
    await recordToolCall({
      companyId: a.companyId,
      connectionId: aConnectionId,
      userId: a.admin.id,
      tool: "whoami",
      result: "error",
      errorCode: "INTERNAL",
      latencyMs: 3,
    });
    const bCalls = await listToolCalls(b.companyId);
    expect(bCalls.map((call) => call.connectionId)).not.toContain(
      aConnectionId,
    );
    expect(
      (await listToolCalls(a.companyId)).map((call) => call.connectionId),
    ).toContain(aConnectionId);
  });

  it("lib:mcp/connections/countToolCallErrors", async () => {
    const since = new Date(Date.now() - 86_400_000);
    const before = await countToolCallErrors(b.companyId, since);
    await recordToolCall({
      companyId: a.companyId,
      connectionId: aConnectionId,
      userId: a.admin.id,
      tool: "whoami",
      result: "denied",
      errorCode: "FORBIDDEN_SCOPE",
      latencyMs: 1,
    });
    expect(await countToolCallErrors(b.companyId, since)).toBe(before);
    expect(await countToolCallErrors(a.companyId, since)).toBeGreaterThan(0);
  });

  it("lib:mcp/connections/purgeExpiredToolCalls", async () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 13);
    const [aOld] = await ownerDb
      .insert(mcpToolCalls)
      .values({
        companyId: a.companyId,
        connectionId: aConnectionId,
        tool: "whoami",
        result: "success",
        latencyMs: 1,
        occurredAt: old,
      })
      .returning();

    // Purging company B never touches company A's log.
    await purgeExpiredToolCalls(b.companyId);
    expect(
      await ownerDb
        .select()
        .from(mcpToolCalls)
        .where(eq(mcpToolCalls.id, aOld.id)),
    ).toHaveLength(1);

    // D-13: older than 12 months goes; recent calls stay.
    expect(await purgeExpiredToolCalls(a.companyId)).toBeGreaterThan(0);
    expect(
      await ownerDb
        .select()
        .from(mcpToolCalls)
        .where(eq(mcpToolCalls.id, aOld.id)),
    ).toHaveLength(0);
    expect((await listToolCalls(a.companyId)).length).toBeGreaterThan(0);
  });
});

describe("the endpoint", () => {
  it("route:POST /api/mcp", async () => {
    const { token: bToken } = await createPersonalToken(b.companyId, {
      userId: b.admin.id,
      name: "B",
      scopes: ["read"],
      expiresInDays: 7,
    });
    const result = await callTool(bToken, "whoami");

    expect(result.status).toBe(200);
    // The company comes from the token; nothing of company A shows up.
    expect(result.body.result.structuredContent.company.id).toBe(b.companyId);
    expect(JSON.stringify(result.body)).not.toContain(a.companyId);
  });

  it("route:GET /api/mcp", async () => {
    expect((await mcpGet(new Request(`${ORIGIN}/api/mcp`))).status).toBe(401);
  });

  it("route:DELETE /api/mcp", async () => {
    expect(
      (await mcpDelete(new Request(`${ORIGIN}/api/mcp`, { method: "DELETE" })))
        .status,
    ).toBe(401);
  });

  it("mcp:whoami", async () => {
    const { token: aToken } = await createPersonalToken(a.companyId, {
      userId: a.admin.id,
      name: "A",
      scopes: ["read", "audit", "pii", "write:people"],
      expiresInDays: 30,
    });
    const { body } = await callTool(aToken, "whoami");
    const data = body.result.structuredContent;

    expect(data.user.id).toBe(a.admin.id);
    expect(data.company).toMatchObject({ id: a.companyId });
    expect(data.role.slug).toBe("admin");
    expect(data.scopes.sort()).toEqual([
      "audit",
      "pii",
      "read",
      "write:people",
    ]);
    expect(data.permissions).toContain("audit:read");
    expect(data.permissions).toContain("people:update");
    expect(data.permissions).not.toContain("people:delete");
    expect(data.permissions).not.toContain("assets:update");
    expect(data.pii_unmasked).toBe(true);
    expect(data.today_mx).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(data.connection.expires_at_mx).toMatch(/^\d{2}\/\d{2}\/\d{4}/);

    const [call] = await ownerDb
      .select()
      .from(mcpToolCalls)
      .where(eq(mcpToolCalls.tool, "whoami"))
      .orderBy(mcpToolCalls.occurredAt)
      .limit(1000)
      .then((rows) =>
        rows.filter((row) => row.companyId === a.companyId && row.piiUnmasked),
      );
    expect(call).toBeDefined();
  });

  it("cuts a connection whose membership was revoked (COMPANY_ACCESS_REVOKED, then 401)", async () => {
    const { token: viewerToken } = await (async () => {
      // Give the viewer create rights for the token, then revoke the membership.
      return createPersonalToken(b.companyId, {
        userId: b.admin.id,
        name: "Por revocar",
        scopes: ["read"],
        expiresInDays: 7,
      });
    })();

    await ownerDb
      .update(companyMemberships)
      .set({ status: "revocada" })
      .where(eq(companyMemberships.id, b.admin.membershipId));

    try {
      const first = await callTool(viewerToken, "whoami");
      expect(first.body.result.isError).toBe(true);
      expect(first.body.result.structuredContent.error.code).toBe(
        "COMPANY_ACCESS_REVOKED",
      );
      expect((await callTool(viewerToken, "whoami")).status).toBe(401);
    } finally {
      await ownerDb
        .update(companyMemberships)
        .set({ status: "activa" })
        .where(eq(companyMemberships.id, b.admin.membershipId));
    }
  });
});
