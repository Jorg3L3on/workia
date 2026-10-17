import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { mcpClients, type McpClient } from "@/lib/db/schema";
import { generateToken, verifyTokenHash } from "@/lib/mcp/tokens";

/**
 * OAuth clients (spec §6): Client ID Metadata Documents first (the client_id
 * is an https URL whose JSON describes the client), Dynamic Client
 * Registration for clients that still use it.
 */

/** Hosts whose CIMD documents are ChatGPT's (OpenAI). Exact host match. */
const OPENAI_HOSTS = ["chatgpt.com", "chat.openai.com", "openai.com"];

const isOpenAiHost = (hostname: string) =>
  OPENAI_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

const CHATGPT_REDIRECT_PATTERNS = [
  /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect\/?$/,
  /^https:\/\/chatgpt\.com\/connector\/oauth\/[^/?#]+$/,
  /^https:\/\/chat\.openai\.com\/connector_platform_oauth_redirect\/?$/,
  /^https:\/\/chat\.openai\.com\/connector\/oauth\/[^/?#]+$/,
];

export const isChatgptRedirectUri = (uri: string) =>
  CHATGPT_REDIRECT_PATTERNS.some((pattern) => pattern.test(uri));

/** Hostnames a metadata fetch must never reach (SSRF): IP literals and local names. */
const isPrivateHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname.endsWith(".local") ||
  hostname.endsWith(".internal") ||
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
  hostname.startsWith("[");

export const isMetadataUrlClientId = (clientId: string) => {
  try {
    const url = new URL(clientId);
    return (
      url.protocol === "https:" &&
      url.pathname.length > 1 &&
      !url.username &&
      !url.password &&
      !isPrivateHostname(url.hostname)
    );
  } catch {
    return false;
  }
};

/**
 * ChatGPT: a CIMD client_id on an OpenAI host, or a redirect_uri of ChatGPT's
 * connector platform. Lives in code (D-01, D-05) and has a test.
 */
export const isChatgptClient = (client: {
  clientId: string;
  redirectUris: readonly string[];
}) => {
  if (isMetadataUrlClientId(client.clientId)) {
    if (isOpenAiHost(new URL(client.clientId).hostname)) {
      return true;
    }
  }

  return client.redirectUris.some(isChatgptRedirectUri);
};

const metadataDocumentSchema = z
  .object({
    client_id: z.string().url(),
    client_name: z.string().min(1).max(200).optional(),
    redirect_uris: z.array(z.string().url()).min(1).max(20),
    grant_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
    client_uri: z.string().url().optional(),
    logo_uri: z.string().url().optional(),
  })
  .passthrough();

/** The document must name the URL it was fetched from (OpenAI hosts may alias each other). */
const documentMatchesUrl = (fetchUrl: string, documentClientId: string) => {
  if (fetchUrl === documentClientId) {
    return true;
  }

  try {
    return (
      isOpenAiHost(new URL(fetchUrl).hostname) &&
      isOpenAiHost(new URL(documentClientId).hostname)
    );
  } catch {
    return false;
  }
};

export const parseMetadataDocument = (fetchUrl: string, json: unknown) => {
  const parsed = metadataDocumentSchema.safeParse(json);

  if (!parsed.success || !documentMatchesUrl(fetchUrl, parsed.data.client_id)) {
    return null;
  }

  return parsed.data;
};

const fetchMetadataDocument = async (clientId: string) => {
  try {
    const response = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    return parseMetadataDocument(clientId, await response.json());
  } catch {
    return null;
  }
};

const TOKEN_AUTH_METHODS = ["none", "private_key_jwt", "client_secret_post"];

const normalizeAuthMethod = (method: string | undefined) =>
  method && TOKEN_AUTH_METHODS.includes(method) ? method : "none";

/** A known client, or a CIMD client_id fetched and remembered now. */
export const resolveClient = async (
  clientId: string,
): Promise<McpClient | null> => {
  const [existing] = await db
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.clientId, clientId))
    .limit(1);

  if (existing) {
    return existing;
  }

  if (!isMetadataUrlClientId(clientId)) {
    return null;
  }

  const document = await fetchMetadataDocument(clientId);

  if (!document) {
    return null;
  }

  const [created] = await db
    .insert(mcpClients)
    .values({
      clientId,
      clientName: document.client_name?.trim() || new URL(clientId).hostname,
      registration: "cimd",
      redirectUris: document.redirect_uris,
      grantTypes: document.grant_types ?? [
        "authorization_code",
        "refresh_token",
      ],
      tokenEndpointAuthMethod: normalizeAuthMethod(
        document.token_endpoint_auth_method,
      ),
      clientUri: document.client_uri ?? null,
      logoUri: document.logo_uri ?? null,
    })
    .onConflictDoNothing({ target: mcpClients.clientId })
    .returning();

  if (created) {
    return created;
  }

  const [raced] = await db
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.clientId, clientId))
    .limit(1);

  return raced ?? null;
};

export const registrationSchema = z
  .object({
    client_name: z.string().trim().min(1).max(120).optional(),
    redirect_uris: z.array(z.string().url()).min(1).max(20),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
    client_uri: z.string().url().optional(),
    logo_uri: z.string().url().optional(),
  })
  .passthrough();

/** Redirect URIs must be https, or http on loopback (native and desktop clients). */
export const isAcceptableRedirectUri = (uri: string) => {
  try {
    const url = new URL(uri);

    if (url.hash) {
      return false;
    }

    if (url.protocol === "https:") {
      return true;
    }

    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

/** Dynamic Client Registration (RFC 7591), kept for clients without CIMD. */
export const registerClient = async (
  input: z.infer<typeof registrationSchema>,
) => {
  const authMethod = normalizeAuthMethod(input.token_endpoint_auth_method);
  const secret =
    authMethod === "client_secret_post" ? generateToken("clientSecret") : null;
  const [client] = await db
    .insert(mcpClients)
    .values({
      clientId: randomUUID(),
      clientName: input.client_name ?? "Cliente MCP",
      registration: "dcr",
      redirectUris: input.redirect_uris,
      grantTypes: input.grant_types ?? ["authorization_code", "refresh_token"],
      tokenEndpointAuthMethod: authMethod,
      clientUri: input.client_uri ?? null,
      logoUri: input.logo_uri ?? null,
      clientSecretHash: secret?.hash ?? null,
    })
    .returning();

  return { client, clientSecret: secret?.token ?? null };
};

/** The redirect URI is one the client registered (exact match). */
export const isRegisteredRedirectUri = (client: McpClient, uri: string) =>
  client.redirectUris.includes(uri) ||
  (isChatgptClient(client) &&
    isMetadataUrlClientId(client.clientId) &&
    isChatgptRedirectUri(uri));

/**
 * Client authentication at the token endpoint. Public clients (none, and
 * private_key_jwt ones such as ChatGPT, which also send PKCE) prove possession
 * with PKCE; client_secret_post clients also need their secret.
 */
export const authenticateClient = (
  client: McpClient,
  clientSecret: string | null | undefined,
) => {
  if (client.tokenEndpointAuthMethod !== "client_secret_post") {
    return true;
  }

  return Boolean(
    client.clientSecretHash &&
    clientSecret &&
    verifyTokenHash(clientSecret, client.clientSecretHash),
  );
};
