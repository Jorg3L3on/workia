import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./rbac";

import { companies } from "./companies";

// Workia MCP connector (WRK-I1, migration 0009). Every table but the OAuth client
// registry and the rate-limit counters belongs to one company (addendum
// multiempresa §4). RLS for the company tables lives in the migration (SQL).

/** OAuth clients known to the installation: CIMD documents and DCR registrations. */
export const mcpClients = pgTable("mcp_clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  /** "cimd" (client_id is a metadata URL) or "dcr" (dynamic registration). */
  registration: text("registration").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  grantTypes: text("grant_types").array().notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
  clientUri: text("client_uri"),
  logoUri: text("logo_uri"),
  clientSecretHash: text("client_secret_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** One-time authorization codes (10 minutes), bound to the company chosen at consent. */
export const mcpAuthCodes = pgTable(
  "mcp_auth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").array().notNull(),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("mcp_auth_codes_code_hash_unique").on(table.codeHash),
    index("mcp_auth_codes_company_id_idx").on(table.companyId),
  ],
);

export type McpRotatedRefresh = { prefix: string; hash: string };

/**
 * A connection: an OAuth grant (access + refresh token) or a personal access
 * token (PAT), of one user in one company. Tokens are stored as a lookup
 * prefix plus a SHA-256 hash, never in clear.
 */
export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "oauth" or "pat". */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    clientId: text("client_id").references(() => mcpClients.clientId, {
      onDelete: "set null",
    }),
    clientName: text("client_name").notNull(),
    /** Identified as ChatGPT: read-only ceiling (D-01, D-05). */
    isChatgpt: boolean("is_chatgpt").notNull().default(false),
    scopes: text("scopes").array().notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenPrefix: text("refresh_token_prefix"),
    refreshTokenHash: text("refresh_token_hash"),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    /** Refresh tokens already rotated: presenting one again revokes the connection. */
    rotatedRefresh: jsonb("rotated_refresh")
      .$type<McpRotatedRefresh[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    resource: text("resource"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("mcp_connections_company_id_id_unique").on(
      table.companyId,
      table.id,
    ),
    uniqueIndex("mcp_connections_token_prefix_unique").on(table.tokenPrefix),
    uniqueIndex("mcp_connections_refresh_token_prefix_unique").on(
      table.refreshTokenPrefix,
    ),
    index("mcp_connections_company_user_idx").on(table.companyId, table.userId),
  ],
);

/** Append-only log of every tool call (success, error or denied). Kept 12 months (D-13). */
export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    tool: text("tool").notNull(),
    /** "success", "error" or "denied". */
    result: text("result").notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms").notNull(),
    requestId: text("request_id"),
    piiUnmasked: boolean("pii_unmasked").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "mcp_tool_calls_company_connection_fk",
      columns: [table.companyId, table.connectionId],
      foreignColumns: [mcpConnections.companyId, mcpConnections.id],
    }).onDelete("cascade"),
    index("mcp_tool_calls_company_occurred_idx").on(
      table.companyId,
      table.occurredAt.desc().nullsFirst(),
    ),
    index("mcp_tool_calls_connection_occurred_idx").on(
      table.connectionId,
      table.occurredAt.desc().nullsFirst(),
    ),
  ],
);

/** Replies of write tools by idempotency key, kept 24 hours (F2a). */
export const mcpIdempotency = pgTable(
  "mcp_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    key: text("key").notNull(),
    tool: text("tool").notNull(),
    argsHash: text("args_hash").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "mcp_idempotency_company_connection_fk",
      columns: [table.companyId, table.connectionId],
      foreignColumns: [mcpConnections.companyId, mcpConnections.id],
    }).onDelete("cascade"),
    uniqueIndex("mcp_idempotency_company_connection_key_unique").on(
      table.companyId,
      table.connectionId,
      table.key,
    ),
    index("mcp_idempotency_expires_at_idx").on(table.expiresAt),
  ],
);

/** Per-company MCP switches. Writes stay off until F2a turns them on. */
export const mcpSettings = pgTable("mcp_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "restrict" }),
  writesEnabled: boolean("writes_enabled").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** Fixed-window counters (connection, user or IP keys). Old windows are pruned lazily. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("rate_limits_window_start_idx").on(table.windowStart),
  ],
);

export type McpClient = typeof mcpClients.$inferSelect;
export type McpConnection = typeof mcpConnections.$inferSelect;
export type McpToolCall = typeof mcpToolCalls.$inferSelect;
