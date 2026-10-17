// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connections = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  memberPermissions: vi.fn(),
  recordToolCall: vi.fn(),
  revokeConnection: vi.fn(),
}));

vi.mock("@/lib/mcp/connections", () => connections);
vi.mock("@/lib/mcp/rate-limit", () => ({
  hitRateLimit: vi.fn(async () => ({
    limited: false,
    count: 1,
    retryAfterSeconds: 60,
  })),
  clientIp: () => "127.0.0.1",
}));

import { DELETE, GET, OPTIONS, POST } from "./route";

const ORIGIN = "http://localhost:3000";

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

const authContext = (scopes: string[]) => ({
  connectionId: "conn-1",
  companyId: "company-1",
  userId: "user-1",
  kind: "pat",
  name: "Grok",
  clientId: null,
  clientName: "Token personal",
  isChatgpt: false,
  scopes,
  expiresAt: new Date(Date.now() + 3_600_000),
});

/** JSON-RPC body of a JSON or SSE response. */
const readRpc = async (response: Response) => {
  const text = await response.text();
  const data = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
  return JSON.parse(data);
};

beforeEach(() => {
  vi.clearAllMocks();
  connections.verifyBearerToken.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/mcp transport", () => {
  it("answers 401 with WWW-Authenticate resource_metadata without a token", async () => {
    const response = await POST(rpc(initialize));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });

  it("answers 401 for an unknown or revoked token", async () => {
    const response = await POST(
      rpc(initialize, { authorization: "Bearer workia_pat_desconocido" }),
    );

    expect(response.status).toBe(401);
    expect(connections.verifyBearerToken).toHaveBeenCalledWith(
      "workia_pat_desconocido",
    );
  });

  it("answers 403 insufficient_scope with scope= when the token lacks read", async () => {
    connections.verifyBearerToken.mockResolvedValue(authContext(["audit"]));

    const response = await POST(
      rpc(initialize, { authorization: "Bearer workia_pat_x" }),
    );

    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("insufficient_scope");
    expect(challenge).toContain('scope="read"');
  });

  it("rejects a browser Origin that is not allowed", async () => {
    connections.verifyBearerToken.mockResolvedValue(authContext(["read"]));

    const response = await POST(
      rpc(initialize, {
        authorization: "Bearer workia_pat_x",
        origin: "https://evil.example",
      }),
    );

    expect(response.status).toBe(403);
    expect(connections.verifyBearerToken).not.toHaveBeenCalled();
  });

  it("answers CORS preflight for allowed origins and echoes them (never *)", async () => {
    const response = await OPTIONS(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "OPTIONS",
        headers: { origin: "https://claude.ai" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://claude.ai",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "mcp-protocol-version",
    );

    const denied = await OPTIONS(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("is off with MCP_ENABLED=0", async () => {
    vi.stubEnv("MCP_ENABLED", "0");
    vi.resetModules();
    const route = await import("./route");

    expect((await route.POST(rpc(initialize))).status).toBe(404);
    expect((await route.GET(new Request(`${ORIGIN}/api/mcp`))).status).toBe(
      404,
    );
  });

  it("initializes as workia and lists whoami with JSON Schema in and out", async () => {
    connections.verifyBearerToken.mockResolvedValue(authContext(["read"]));
    const headers = { authorization: "Bearer workia_pat_x" };

    const init = await POST(rpc(initialize, headers));
    expect(init.status).toBe(200);
    const initBody = await readRpc(init);
    expect(initBody.result.serverInfo.name).toBe("workia");
    expect(initBody.result.instructions).toContain("whoami");

    const list = await readRpc(
      await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, headers)),
    );
    const whoami = list.result.tools.find(
      (tool: { name: string }) => tool.name === "whoami",
    );

    expect(whoami.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(whoami.inputSchema.type).toBe("object");
    expect(whoami.outputSchema.properties).toHaveProperty("company");
  });

  it("exposes GET and DELETE behind the same auth", async () => {
    expect((await GET(new Request(`${ORIGIN}/api/mcp`))).status).toBe(401);
    expect(
      (await DELETE(new Request(`${ORIGIN}/api/mcp`, { method: "DELETE" })))
        .status,
    ).toBe(401);
  });
});
