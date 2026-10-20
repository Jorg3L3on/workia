// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const connections = vi.hoisted(() => ({
  memberPermissions: vi.fn(),
  recordToolCall: vi.fn(),
  revokeConnection: vi.fn(),
}));
const rateLimit = vi.hoisted(() => ({ hitRateLimit: vi.fn() }));

vi.mock("./connections", () => connections);
vi.mock("./rate-limit", () => rateLimit);
vi.mock("./settings", () => ({
  getMcpSettings: vi.fn(async () => ({ writesEnabled: false })),
}));

import type { McpAuthContext } from "./connections";
import {
  defineTool,
  defineWriteTool,
  readAnnotations,
  runWorkiaTool,
  writeAnnotations,
} from "./run-tool";

const auth = (overrides: Partial<McpAuthContext> = {}): McpAuthContext => ({
  connectionId: "conn-1",
  companyId: "company-1",
  userId: "user-1",
  kind: "pat",
  name: "Grok",
  clientId: null,
  clientName: "Token personal",
  isChatgpt: false,
  scopes: ["read"],
  expiresAt: new Date("2026-12-01T00:00:00Z"),
  ...overrides,
});

const ctx = (value: McpAuthContext | null) => ({
  http: value
    ? {
        authInfo: {
          token: "t",
          clientId: "c",
          scopes: [],
          extra: { workia: value },
        },
      }
    : undefined,
});

const handler = vi.fn(
  async (
    { n }: { n: number },
    toolCtx: { companyId: string; piiUnmasked: boolean },
  ) => ({
    doubled: n * 2,
    company: toolCtx.companyId,
    pii: toolCtx.piiUnmasked,
  }),
);

const tool = (overrides: Record<string, unknown> = {}) =>
  defineTool({
    name: "demo",
    title: "Demo",
    description: "Demo",
    kind: "read",
    scope: "read",
    permission: "people:read",
    input: z.object({ n: z.number().int() }),
    output: z.object({
      doubled: z.number(),
      company: z.string(),
      pii: z.boolean(),
    }),
    annotations: readAnnotations("Demo"),
    handler,
    ...overrides,
  });

const member = (permissions: string[], roleSlug = "editor") => ({
  roleSlug,
  permissions: new Set(permissions),
});

beforeEach(() => {
  vi.clearAllMocks();
  connections.memberPermissions.mockResolvedValue(
    member(["people:read", "people:update"]),
  );
  rateLimit.hitRateLimit.mockResolvedValue({
    limited: false,
    count: 1,
    retryAfterSeconds: 60,
  });
});

const lastCall = () => connections.recordToolCall.mock.calls.at(-1)?.[0];

describe("runWorkiaTool", () => {
  it("runs the handler with the connection's company and logs success", async () => {
    const result = await runWorkiaTool(tool(), { n: 2 }, ctx(auth()));

    expect(result).toMatchObject({
      structuredContent: { doubled: 4, company: "company-1", pii: false },
    });
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
    expect(lastCall()).toMatchObject({
      companyId: "company-1",
      connectionId: "conn-1",
      tool: "demo",
      result: "success",
      piiUnmasked: false,
    });
  });

  it("answers UNAUTHENTICATED without a verified connection", async () => {
    const result = await runWorkiaTool(tool(), { n: 1 }, ctx(null));

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "UNAUTHENTICATED" } },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("denies a tool whose scope the connection lacks (FORBIDDEN_SCOPE)", async () => {
    const result = await runWorkiaTool(
      tool({ scope: "audit" }),
      { n: 1 },
      ctx(auth()),
    );

    expect(result).toMatchObject({
      structuredContent: { error: { code: "FORBIDDEN_SCOPE" } },
    });
    expect(lastCall()).toMatchObject({
      result: "denied",
      errorCode: "FORBIDDEN_SCOPE",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("sends ChatGPT write attempts to Grok Bot or the app, even with a write scope stored", async () => {
    const result = await runWorkiaTool(
      tool({
        kind: "write",
        scope: "write:assets",
        permission: "assets:update",
      }),
      { n: 1 },
      ctx(auth({ isChatgpt: true, scopes: ["read", "write:assets"] })),
    );

    expect(result).toMatchObject({
      structuredContent: { error: { code: "FORBIDDEN_SCOPE" } },
    });
    expect(
      (result as { structuredContent: { error: { message: string } } })
        .structuredContent.error.message,
    ).toMatch(/Grok Bot o la app/);
  });

  it("denies when the role lacks the permission, whatever the scopes (FORBIDDEN_RBAC)", async () => {
    connections.memberPermissions.mockResolvedValue(
      member(["contracts:read"], "viewer"),
    );

    const result = await runWorkiaTool(tool(), { n: 1 }, ctx(auth()));

    expect(result).toMatchObject({
      structuredContent: { error: { code: "FORBIDDEN_RBAC" } },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("revokes the connection when the membership is gone (COMPANY_ACCESS_REVOKED)", async () => {
    connections.memberPermissions.mockResolvedValue(null);

    const result = await runWorkiaTool(tool(), { n: 1 }, ctx(auth()));

    expect(result).toMatchObject({
      structuredContent: { error: { code: "COMPANY_ACCESS_REVOKED" } },
    });
    expect(connections.revokeConnection).toHaveBeenCalledWith(
      "company-1",
      "conn-1",
      {
        userId: null,
        reason: "company_access_revoked",
      },
    );
  });

  it("rate limits per connection with retry_after_s (120 reads/min)", async () => {
    rateLimit.hitRateLimit.mockResolvedValue({
      limited: true,
      count: 121,
      retryAfterSeconds: 17,
    });

    const result = await runWorkiaTool(tool(), { n: 1 }, ctx(auth()));

    expect(rateLimit.hitRateLimit).toHaveBeenCalledWith(
      "mcp:read:conn-1",
      120,
      60_000,
      expect.any(Date),
    );
    expect(result).toMatchObject({
      structuredContent: { error: { code: "RATE_LIMITED", retry_after_s: 17 } },
    });
  });

  it("returns VALIDATION for bad arguments and INTERNAL for unexpected errors", async () => {
    expect(await runWorkiaTool(tool(), { n: "x" }, ctx(auth()))).toMatchObject({
      structuredContent: { error: { code: "VALIDATION" } },
    });

    handler.mockRejectedValueOnce(new Error("boom: secret value"));
    const failed = await runWorkiaTool(tool(), { n: 1 }, ctx(auth()));

    expect(failed).toMatchObject({
      structuredContent: { error: { code: "INTERNAL" } },
    });
    expect(JSON.stringify(failed)).not.toContain("secret value");
    expect(lastCall()).toMatchObject({
      result: "error",
      errorCode: "INTERNAL",
    });
  });

  it("unmasks PII only with the pii scope and people:update", async () => {
    const withPii = await runWorkiaTool(
      tool(),
      { n: 1 },
      ctx(auth({ scopes: ["read", "pii"] })),
    );
    expect(withPii).toMatchObject({ structuredContent: { pii: true } });
    expect(lastCall()).toMatchObject({ piiUnmasked: true });

    connections.memberPermissions.mockResolvedValue(
      member(["people:read"], "viewer"),
    );
    const withoutPermission = await runWorkiaTool(
      tool(),
      { n: 1 },
      ctx(auth({ scopes: ["read", "pii"] })),
    );
    expect(withoutPermission).toMatchObject({
      structuredContent: { pii: false },
    });
  });

  it("drops pii from ChatGPT connections unless the role is super_admin", async () => {
    const chatgpt = auth({ isChatgpt: true, scopes: ["read", "pii"] });

    expect(await runWorkiaTool(tool(), { n: 1 }, ctx(chatgpt))).toMatchObject({
      structuredContent: { pii: false },
    });

    connections.memberPermissions.mockResolvedValue(
      member(["people:read", "people:update"], "super_admin"),
    );
    expect(await runWorkiaTool(tool(), { n: 1 }, ctx(chatgpt))).toMatchObject({
      structuredContent: { pii: true },
    });
  });
});

describe("write tools", () => {
  const writeTool = defineWriteTool({
    name: "demo_write",
    title: "Demo",
    description: "Demo de escritura",
    scope: "write:assets",
    permission: "assets:update",
    input: z.object({ n: z.number() }),
    output: z.object({ ok: z.boolean() }),
    annotations: writeAnnotations("Demo"),
    preview: async () => ({ summary: "demo" }),
    handler: async () => ({ ok: true }),
  });

  it("use the 20 per minute write bucket and stop at WRITES_DISABLED when off", async () => {
    connections.memberPermissions.mockResolvedValue(member(["assets:update"]));

    const result = await runWorkiaTool(
      writeTool,
      { n: 1, idempotency_key: "llave-1234" },
      ctx(auth({ scopes: ["read", "write:assets"] })),
    );

    expect(rateLimit.hitRateLimit).toHaveBeenCalledWith(
      "mcp:write:conn-1",
      20,
      60_000,
      expect.any(Date),
    );
    expect(result).toMatchObject({
      structuredContent: { error: { code: "WRITES_DISABLED" } },
    });
    expect(lastCall()).toMatchObject({
      result: "denied",
      errorCode: "WRITES_DISABLED",
    });
  });

  it("require an idempotency_key in the input schema", () => {
    expect(writeTool.input.safeParse({ n: 1 }).success).toBe(false);
    expect(
      writeTool.input.safeParse({ n: 1, idempotency_key: "llave-1234" })
        .success,
    ).toBe(true);
  });
});
