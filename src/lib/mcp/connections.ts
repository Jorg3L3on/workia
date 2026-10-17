import { and, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db, tdb } from "@/lib/db";
import {
  mcpAuthCodes,
  mcpConnections,
  mcpToolCalls,
  users,
  type McpConnection,
} from "@/lib/db/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import {
  combinePermissions,
  getRolePermissionSlugs,
  listActiveMemberships,
} from "@/lib/tenant/memberships";

import {
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  TOOL_CALL_RETENTION_MONTHS,
  type PatExpiryDays,
} from "./config";
import {
  applyClientCeiling,
  grantableScopes,
  isMcpScope,
  type McpScope,
} from "./scopes";
import {
  generateToken,
  hashToken,
  lookupPrefix,
  tokenKind,
  verifyPkceS256,
  verifyTokenHash,
} from "./tokens";

/** What a verified bearer token stands for. Rides in AuthInfo.extra to every tool. */
export type McpAuthContext = {
  connectionId: string;
  companyId: string;
  userId: string;
  kind: "oauth" | "pat";
  name: string;
  clientId: string | null;
  clientName: string;
  isChatgpt: boolean;
  scopes: McpScope[];
  expiresAt: Date;
};

export class InvalidGrantError extends Error {
  constructor(readonly reason: string) {
    super(`invalid_grant: ${reason}`);
    this.name = "InvalidGrantError";
  }
}

/** Rotated refresh tokens remembered for reuse detection. */
const MAX_ROTATED_REFRESH = 50;

const toScopes = (values: readonly string[]) => values.filter(isMcpScope);

/**
 * Which company holds a credential, before anything else is known about it.
 * Runs the SECURITY DEFINER function of 0009_mcp so it works under RLS too.
 */
const credentialCompany = async (lookup: string): Promise<string | null> => {
  const result = await db.execute<{ company_id: string | null }>(
    sql`select mcp_credential_company(${lookup}) as company_id`,
  );

  return result.rows[0]?.company_id ?? null;
};

/** Role permissions of an active member of the company, or null (no access). */
export const memberPermissions = async (
  userId: string,
  companyId: string,
): Promise<{ roleSlug: string; permissions: Set<PermissionSlug> } | null> => {
  const membership = (await listActiveMemberships(userId)).find(
    (candidate) => candidate.companyId === companyId,
  );

  if (!membership) {
    return null;
  }

  // Platform permissions never reach MCP (addendum §2): platformAdmin = false.
  return {
    roleSlug: membership.roleSlug,
    permissions: combinePermissions(
      await getRolePermissionSlugs(membership.roleId),
      false,
    ),
  };
};

const auditConnection = (
  connection: Pick<
    McpConnection,
    "id" | "companyId" | "kind" | "name" | "clientName" | "scopes"
  >,
  action: "create" | "revoke",
  actorUserId: string | null,
  summary: string,
) =>
  recordAuditEvent({
    companyId: connection.companyId,
    actorUserId,
    resourceType: "mcp_connection",
    resourceId: connection.id,
    action,
    payload: {
      summary,
      after: {
        kind: connection.kind,
        name: connection.name,
        client: connection.clientName,
        scopes: connection.scopes,
      },
    },
  });

// ---------------------------------------------------------------------------
// Authorization codes and OAuth grants
// ---------------------------------------------------------------------------

export type AuthCodeInput = {
  userId: string;
  clientId: string;
  redirectUri: string;
  scopes: McpScope[];
  codeChallenge: string;
  resource: string;
};

/** A one-time code for the company chosen at consent (10 minutes). */
export const createAuthCode = async (
  companyId: string,
  input: AuthCodeInput,
) => {
  const code = generateToken("code");

  await tdb(companyId)
    .insert(mcpAuthCodes)
    .values({
      companyId,
      codeHash: code.hash,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    });

  return code.token;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const tokenResponse = (
  access: string,
  refresh: string,
  scopes: readonly string[],
): TokenResponse => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  refresh_token: refresh,
  scope: scopes.join(" "),
});

/**
 * Scopes a grant may keep right now: the ones the user's role can still grant,
 * capped by the client (ChatGPT never gets write:*, and pii only from a
 * super_admin). Re-applied at the token endpoint whatever the code asked for.
 */
const allowedGrantScopes = (
  requested: readonly McpScope[],
  member: { roleSlug: string; permissions: Set<PermissionSlug> },
  isChatgpt: boolean,
) => {
  const grantable = new Set(grantableScopes(member.permissions));

  return applyClientCeiling(
    requested.filter((scope) => grantable.has(scope)),
    { isChatgpt, allowChatgptPii: member.roleSlug === "super_admin" },
  );
};

export type ExchangeCodeInput = {
  code: string;
  clientId: string;
  clientName: string;
  isChatgpt: boolean;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
  sameResource: (a: string, b: string) => boolean;
};

/** authorization_code grant: verifies the code and PKCE, then opens a connection. */
export const exchangeAuthCode = async (
  input: ExchangeCodeInput,
): Promise<TokenResponse> => {
  const codeHash = hashToken(input.code);
  const companyId = await credentialCompany(codeHash);

  if (!companyId) {
    throw new InvalidGrantError("not_found");
  }

  const now = new Date();
  // Mark used first, atomically: a code is redeemed once even under a race.
  const [row] = await tdb(companyId)
    .update(mcpAuthCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(mcpAuthCodes.companyId, companyId),
        eq(mcpAuthCodes.codeHash, codeHash),
        isNull(mcpAuthCodes.usedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new InvalidGrantError("used");
  }

  if (row.expiresAt <= now) throw new InvalidGrantError("expired");
  if (row.clientId !== input.clientId) throw new InvalidGrantError("client");
  if (row.redirectUri !== input.redirectUri)
    throw new InvalidGrantError("redirect_uri");
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge))
    throw new InvalidGrantError("pkce");
  if (input.resource && !input.sameResource(input.resource, row.resource))
    throw new InvalidGrantError("resource");

  const member = await memberPermissions(row.userId, companyId);

  if (!member || !member.permissions.has("mcp_connections:create")) {
    throw new InvalidGrantError("membership");
  }

  const scopes = allowedGrantScopes(
    toScopes(row.scopes),
    member,
    input.isChatgpt,
  );
  const access = generateToken("access");
  const refresh = generateToken("refresh");
  const [connection] = await tdb(companyId)
    .insert(mcpConnections)
    .values({
      companyId,
      userId: row.userId,
      kind: "oauth",
      name: input.clientName,
      clientId: input.clientId,
      clientName: input.clientName,
      isChatgpt: input.isChatgpt,
      scopes,
      tokenPrefix: access.prefix,
      tokenHash: access.hash,
      tokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshTokenPrefix: refresh.prefix,
      refreshTokenHash: refresh.hash,
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      resource: row.resource,
    })
    .returning();

  await auditConnection(
    connection,
    "create",
    row.userId,
    `Conexión OAuth «${input.clientName}» autorizada`,
  );

  return tokenResponse(access.token, refresh.token, scopes);
};

/**
 * refresh_token grant: rotates both tokens. Presenting a refresh token that
 * was already rotated is a theft signal: the whole connection is revoked.
 */
export const refreshConnection = async (input: {
  refreshToken: string;
  clientId: string;
  resource: string | null;
  sameResource: (a: string, b: string) => boolean;
}): Promise<TokenResponse> => {
  const prefix =
    tokenKind(input.refreshToken) === "refresh"
      ? lookupPrefix(input.refreshToken)
      : null;
  const companyId = prefix ? await credentialCompany(prefix) : null;

  if (!prefix || !companyId) {
    throw new InvalidGrantError("not_found");
  }

  const [current] = await tdb(companyId)
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.refreshTokenPrefix, prefix),
      ),
    )
    .limit(1);

  if (!current) {
    const [reused] = await tdb(companyId)
      .select()
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.companyId, companyId),
          sql`${mcpConnections.rotatedRefresh} @> ${JSON.stringify([{ prefix }])}::jsonb`,
        ),
      )
      .limit(1);
    const rotated = reused?.rotatedRefresh.find(
      (entry) => entry.prefix === prefix,
    );

    if (
      reused &&
      rotated &&
      verifyTokenHash(input.refreshToken, rotated.hash) &&
      !reused.revokedAt
    ) {
      await revokeConnectionRow(reused, null, "refresh_reuse");
    }

    throw new InvalidGrantError("reused");
  }

  const now = new Date();

  if (
    !current.refreshTokenHash ||
    !verifyTokenHash(input.refreshToken, current.refreshTokenHash)
  )
    throw new InvalidGrantError("not_found");
  if (current.revokedAt) throw new InvalidGrantError("revoked");
  if (!current.refreshExpiresAt || current.refreshExpiresAt <= now)
    throw new InvalidGrantError("expired");
  if (current.clientId !== input.clientId)
    throw new InvalidGrantError("client");
  if (
    input.resource &&
    current.resource &&
    !input.sameResource(input.resource, current.resource)
  )
    throw new InvalidGrantError("resource");

  const member = await memberPermissions(current.userId, companyId);

  if (!member) {
    await revokeConnectionRow(current, null, "company_access_revoked");
    throw new InvalidGrantError("membership");
  }

  // The role may have shrunk since consent; scopes never grow on their own.
  const scopes = allowedGrantScopes(
    toScopes(current.scopes),
    member,
    current.isChatgpt,
  );
  const access = generateToken("access");
  const refresh = generateToken("refresh");
  const rotatedRefresh = [
    { prefix, hash: current.refreshTokenHash },
    ...current.rotatedRefresh,
  ].slice(0, MAX_ROTATED_REFRESH);
  const [updated] = await tdb(companyId)
    .update(mcpConnections)
    .set({
      scopes,
      tokenPrefix: access.prefix,
      tokenHash: access.hash,
      tokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshTokenPrefix: refresh.prefix,
      refreshTokenHash: refresh.hash,
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      rotatedRefresh,
    })
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.id, current.id),
        // Two refreshes racing with the same token: only one rotates.
        eq(mcpConnections.refreshTokenPrefix, prefix),
      ),
    )
    .returning({ id: mcpConnections.id });

  if (!updated) {
    throw new InvalidGrantError("reused");
  }

  return tokenResponse(access.token, refresh.token, scopes);
};

/** RFC 7009: revokes the connection an access or refresh token belongs to. */
export const revokeByToken = async (token: string) => {
  const kind = tokenKind(token);
  const prefix = lookupPrefix(token);

  if (!prefix || (kind !== "access" && kind !== "refresh" && kind !== "pat")) {
    return;
  }

  const companyId = await credentialCompany(prefix);

  if (!companyId) {
    return;
  }

  const column =
    kind === "refresh"
      ? mcpConnections.refreshTokenPrefix
      : mcpConnections.tokenPrefix;
  const [row] = await tdb(companyId)
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.companyId, companyId), eq(column, prefix)))
    .limit(1);
  const hash = kind === "refresh" ? row?.refreshTokenHash : row?.tokenHash;

  if (row && hash && verifyTokenHash(token, hash) && !row.revokedAt) {
    await revokeConnectionRow(row, null, "client_revoked");
  }
};

// ---------------------------------------------------------------------------
// Bearer verification
// ---------------------------------------------------------------------------

/** Don't write last_used_at more than once a minute per connection. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * Verifies a bearer token (PAT or OAuth access token): known prefix, constant-
 * time hash match, not revoked, not expired. Membership and permissions are
 * checked per tool call, where a revocation also revokes the connection.
 */
export const verifyBearerToken = async (
  token: string,
  now = new Date(),
): Promise<McpAuthContext | null> => {
  const kind = tokenKind(token);
  const prefix = lookupPrefix(token);

  if (!prefix || (kind !== "pat" && kind !== "access")) {
    return null;
  }

  const companyId = await credentialCompany(prefix);

  if (!companyId) {
    return null;
  }

  const [row] = await tdb(companyId)
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.tokenPrefix, prefix),
      ),
    )
    .limit(1);

  if (
    !row ||
    row.revokedAt ||
    row.tokenExpiresAt <= now ||
    !verifyTokenHash(token, row.tokenHash) ||
    (kind === "pat") !== (row.kind === "pat")
  ) {
    return null;
  }

  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS
  ) {
    await tdb(companyId)
      .update(mcpConnections)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(mcpConnections.companyId, companyId),
          eq(mcpConnections.id, row.id),
        ),
      );
  }

  return {
    connectionId: row.id,
    companyId,
    userId: row.userId,
    kind: row.kind === "pat" ? "pat" : "oauth",
    name: row.name,
    clientId: row.clientId,
    clientName: row.clientName,
    isChatgpt: row.isChatgpt,
    scopes: toScopes(row.scopes),
    expiresAt: row.tokenExpiresAt,
  };
};

// ---------------------------------------------------------------------------
// Personal tokens and the connections screen
// ---------------------------------------------------------------------------

export type CreatePatInput = {
  userId: string;
  name: string;
  scopes: McpScope[];
  expiresInDays: PatExpiryDays;
};

/**
 * A personal access token for the user in this company. Scopes the user's
 * role cannot grant are dropped. The token is returned once and never stored.
 */
export const createPersonalToken = async (
  companyId: string,
  input: CreatePatInput,
) => {
  const member = await memberPermissions(input.userId, companyId);

  if (!member || !member.permissions.has("mcp_connections:create")) {
    throw new Error("Sin permiso para crear conexiones en esta empresa.");
  }

  const grantable = new Set(grantableScopes(member.permissions));
  const scopes = [
    ...new Set<McpScope>([
      "read",
      ...input.scopes.filter(
        (scope) => grantable.has(scope) && scope !== "offline_access",
      ),
    ]),
  ];
  const token = generateToken("pat");
  const [connection] = await tdb(companyId)
    .insert(mcpConnections)
    .values({
      companyId,
      userId: input.userId,
      kind: "pat",
      name: input.name,
      clientName: "Token personal",
      scopes,
      tokenPrefix: token.prefix,
      tokenHash: token.hash,
      tokenExpiresAt: new Date(
        Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
      ),
    })
    .returning();

  await auditConnection(
    connection,
    "create",
    input.userId,
    `Token personal «${input.name}» creado`,
  );

  return { connection, token: token.token };
};

const revokeConnectionRow = async (
  row: McpConnection,
  actorUserId: string | null,
  reason: string,
) => {
  const [revoked] = await tdb(row.companyId)
    .update(mcpConnections)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(mcpConnections.companyId, row.companyId),
        eq(mcpConnections.id, row.id),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .returning();

  if (revoked) {
    await auditConnection(
      revoked,
      "revoke",
      actorUserId,
      `Conexión «${revoked.name}» revocada (${reason})`,
    );
  }

  return revoked ?? null;
};

/** Revokes a connection of the company (the next call fails). Null if not found. */
export const revokeConnection = async (
  companyId: string,
  connectionId: string,
  actor: { userId: string | null; reason: string },
) => {
  const [row] = await tdb(companyId)
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.id, connectionId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return row.revokedAt
    ? row
    : revokeConnectionRow(row, actor.userId, actor.reason);
};

/** Hides a revoked or expired connection from the list. */
export const hideConnection = async (
  companyId: string,
  connectionId: string,
) => {
  const [row] = await tdb(companyId)
    .update(mcpConnections)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.id, connectionId),
      ),
    )
    .returning({ id: mcpConnections.id });

  return row ?? null;
};

/** A connection of the company by id (for the screen's guards). */
export const getConnection = async (
  companyId: string,
  connectionId: string,
) => {
  const [row] = await tdb(companyId)
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.id, connectionId),
      ),
    )
    .limit(1);

  return row ?? null;
};

export type ConnectionListItem = Pick<
  McpConnection,
  | "id"
  | "userId"
  | "kind"
  | "name"
  | "clientName"
  | "isChatgpt"
  | "scopes"
  | "tokenPrefix"
  | "tokenExpiresAt"
  | "refreshExpiresAt"
  | "lastUsedAt"
  | "revokedAt"
  | "revokedReason"
  | "createdAt"
> & { userName: string | null; userEmail: string | null };

/** Visible connections of the company, newest first; only `userId`'s when given. */
export const listConnections = async (
  companyId: string,
  options: { userId?: string } = {},
): Promise<ConnectionListItem[]> =>
  tdb(companyId)
    .select({
      id: mcpConnections.id,
      userId: mcpConnections.userId,
      kind: mcpConnections.kind,
      name: mcpConnections.name,
      clientName: mcpConnections.clientName,
      isChatgpt: mcpConnections.isChatgpt,
      scopes: mcpConnections.scopes,
      tokenPrefix: mcpConnections.tokenPrefix,
      tokenExpiresAt: mcpConnections.tokenExpiresAt,
      refreshExpiresAt: mcpConnections.refreshExpiresAt,
      lastUsedAt: mcpConnections.lastUsedAt,
      revokedAt: mcpConnections.revokedAt,
      revokedReason: mcpConnections.revokedReason,
      createdAt: mcpConnections.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(mcpConnections)
    .leftJoin(users, eq(users.id, mcpConnections.userId))
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        isNull(mcpConnections.hiddenAt),
        options.userId ? eq(mcpConnections.userId, options.userId) : undefined,
      ),
    )
    .orderBy(desc(mcpConnections.createdAt));

/** New connections of a user in the last hour (10/hour limit, spec §7). */
export const countRecentConnections = async (
  companyId: string,
  userId: string,
  since: Date,
) => {
  const [row] = await tdb(companyId)
    .select({ total: count() })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.userId, userId),
        gte(mcpConnections.createdAt, since),
      ),
    );

  return row?.total ?? 0;
};

// ---------------------------------------------------------------------------
// Tool call log
// ---------------------------------------------------------------------------

export type ToolCallRecord = {
  companyId: string;
  connectionId: string;
  userId: string | null;
  tool: string;
  result: "success" | "error" | "denied";
  errorCode?: string | null;
  latencyMs: number;
  requestId?: string | null;
  piiUnmasked?: boolean;
};

/** Retention sweep runs on a small share of writes (D-13: lazy delete, no job). */
const PURGE_PROBABILITY = 0.01;

const retentionCutoff = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - TOOL_CALL_RETENTION_MONTHS);
  return cutoff;
};

/** Appends a tool call (append-only; only the 12-month retention deletes). */
export const recordToolCall = async (record: ToolCallRecord) => {
  await tdb(record.companyId)
    .insert(mcpToolCalls)
    .values({
      companyId: record.companyId,
      connectionId: record.connectionId,
      userId: record.userId,
      tool: record.tool,
      result: record.result,
      errorCode: record.errorCode ?? null,
      latencyMs: Math.max(0, Math.round(record.latencyMs)),
      requestId: record.requestId ?? null,
      piiUnmasked: record.piiUnmasked ?? false,
    });

  if (Math.random() < PURGE_PROBABILITY) {
    await purgeExpiredToolCalls(record.companyId);
  }
};

/** Deletes tool calls older than the retention period (12 months). */
export const purgeExpiredToolCalls = async (
  companyId: string,
  now = new Date(),
) => {
  const deleted = await tdb(companyId)
    .delete(mcpToolCalls)
    .where(
      and(
        eq(mcpToolCalls.companyId, companyId),
        lt(mcpToolCalls.occurredAt, retentionCutoff(now)),
      ),
    )
    .returning({ id: mcpToolCalls.id });

  return deleted.length;
};

export type ToolCallListItem = {
  id: string;
  connectionId: string;
  connectionName: string | null;
  userName: string | null;
  tool: string;
  result: string;
  errorCode: string | null;
  latencyMs: number;
  piiUnmasked: boolean;
  occurredAt: Date;
};

/** Latest tool calls of the company (or of `userId`'s connections). */
export const listToolCalls = async (
  companyId: string,
  options: { userId?: string; limit?: number } = {},
): Promise<ToolCallListItem[]> =>
  tdb(companyId)
    .select({
      id: mcpToolCalls.id,
      connectionId: mcpToolCalls.connectionId,
      connectionName: mcpConnections.name,
      userName: users.name,
      tool: mcpToolCalls.tool,
      result: mcpToolCalls.result,
      errorCode: mcpToolCalls.errorCode,
      latencyMs: mcpToolCalls.latencyMs,
      piiUnmasked: mcpToolCalls.piiUnmasked,
      occurredAt: mcpToolCalls.occurredAt,
    })
    .from(mcpToolCalls)
    .innerJoin(
      mcpConnections,
      and(
        eq(mcpConnections.companyId, mcpToolCalls.companyId),
        eq(mcpConnections.id, mcpToolCalls.connectionId),
      ),
    )
    .leftJoin(users, eq(users.id, mcpToolCalls.userId))
    .where(
      and(
        eq(mcpToolCalls.companyId, companyId),
        options.userId ? eq(mcpConnections.userId, options.userId) : undefined,
      ),
    )
    .orderBy(desc(mcpToolCalls.occurredAt), desc(mcpToolCalls.id))
    .limit(options.limit ?? 50);

/** Failed or denied calls since `since` (the "errores 24 h" counter). */
export const countToolCallErrors = async (
  companyId: string,
  since: Date,
  options: { userId?: string } = {},
) => {
  const [row] = await tdb(companyId)
    .select({ total: count() })
    .from(mcpToolCalls)
    .innerJoin(
      mcpConnections,
      and(
        eq(mcpConnections.companyId, mcpToolCalls.companyId),
        eq(mcpConnections.id, mcpToolCalls.connectionId),
      ),
    )
    .where(
      and(
        eq(mcpToolCalls.companyId, companyId),
        gte(mcpToolCalls.occurredAt, since),
        sql`${mcpToolCalls.result} <> 'success'`,
        options.userId ? eq(mcpConnections.userId, options.userId) : undefined,
      ),
    );

  return row?.total ?? 0;
};
