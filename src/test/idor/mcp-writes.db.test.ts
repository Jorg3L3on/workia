/**
 * MCP write infrastructure (WRK-I1-5) against a real database: preview and
 * confirmation, idempotency, audit with source "mcp", the writes switch and
 * the atomic renewal. Test titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createActivity } from "@/lib/catalog";
import { renewContract } from "@/lib/contracts";
import {
  activities,
  auditEvents,
  companyMemberships,
  contracts,
  mcpIdempotency,
  mcpToolCalls,
  roles,
} from "@/lib/db/schema";
import { setWritesEnabledAction } from "@/lib/mcp/actions";
import { createPersonalToken, verifyBearerToken } from "@/lib/mcp/connections";
import {
  completeIdempotencyKey,
  findIdempotentReply,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from "@/lib/mcp/idempotency";
import {
  defineWriteTool,
  runWorkiaTool,
  writeAnnotations,
} from "@/lib/mcp/run-tool";
import type { McpScope } from "@/lib/mcp/scopes";
import { getMcpSettings, setMcpWritesEnabled } from "@/lib/mcp/settings";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let superAdmin: { id: string; email: string };

/** A write tool over a real domain function, to exercise the write path. */
const createActivityTool = defineWriteTool({
  name: "test_create_activity",
  title: "Crear actividad (prueba)",
  description: "Herramienta de prueba de la infraestructura de escritura.",
  scope: "write:catalog",
  permission: "positions:create",
  input: z.object({ name: z.string().min(1) }),
  output: z.object({
    activity: z.object({ id: z.string(), name: z.string() }),
  }),
  annotations: writeAnnotations("Crear actividad (prueba)"),
  preview: async ({ name }) => ({ summary: `Alta de la actividad «${name}»` }),
  handler: async ({ name }, ctx) => {
    const created = await createActivity(
      ctx.companyId,
      { name, active: true },
      ctx.userId,
    );
    return { activity: { id: created.id, name: created.name } };
  },
});

type Result = {
  isError?: boolean;
  structuredContent: Record<string, unknown> & {
    error?: { code: string };
    confirmation_token?: string;
    status?: string;
    audit_event_ids?: string[];
    activity?: { id: string };
  };
};

const contextFor = async (
  tenant: Tenant,
  userId: string,
  scopes: McpScope[],
) => {
  const { token } = await createPersonalToken(tenant.companyId, {
    userId,
    name: `writes ${scopes.join(",")}`,
    scopes,
    expiresInDays: 7,
  });
  const auth = await verifyBearerToken(token);
  return {
    http: {
      authInfo: { token, clientId: "pat", scopes, extra: { workia: auth } },
    },
  };
};

const run = (ctx: unknown, args: Record<string, unknown>, now?: Date) =>
  runWorkiaTool(createActivityTool, args, ctx as never, now) as Promise<Result>;

const activityCount = async (tenant: Tenant, name: string) =>
  (
    await ownerDb
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.companyId, tenant.companyId),
          eq(activities.name, name),
        ),
      )
  ).length;

let aWriter: unknown;

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
  aWriter = await contextFor(a, a.admin.id, ["read", "write:catalog"]);
  await setMcpWritesEnabled(a.companyId, true, a.admin.id);

  const [role] = await ownerDb
    .select()
    .from(roles)
    .where(eq(roles.slug, "super_admin"));
  const { users } = await import("@/lib/db/schema");
  const [user] = await ownerDb
    .insert(users)
    .values({ email: `super-${a.companyId}@idor.test`, name: "Super A" })
    .returning();
  await ownerDb
    .insert(companyMemberships)
    .values({ userId: user.id, companyId: a.companyId, roleId: role.id });
  superAdmin = { id: user.id, email: user.email };
});

describe("preview and confirmation (D-06)", () => {
  it("previews without writing and returns a token bound to the arguments", async () => {
    const preview = await run(aWriter, {
      name: "Inventario A1",
      idempotency_key: "key-preview-1",
    });

    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({
      status: "preview",
      code: "CONFIRMATION_REQUIRED",
      preview: { summary: "Alta de la actividad «Inventario A1»" },
    });
    expect(preview.structuredContent.expires_at_mx).toMatch(
      /^\d{2}\/\d{2}\/\d{4}/,
    );
    expect(await activityCount(a, "Inventario A1")).toBe(0);
  });

  it("writes with the token, and refuses it for other arguments or once expired", async () => {
    const args = { name: "Inventario A2", idempotency_key: "key-confirm-2" };
    const preview = await run(aWriter, args);
    const token = preview.structuredContent.confirmation_token!;

    const tampered = await run(aWriter, {
      ...args,
      name: "Otra cosa",
      confirmation_token: token,
    });
    expect(tampered.structuredContent.error?.code).toBe("CONFIRMATION_INVALID");

    const later = new Date(Date.now() + 11 * 60 * 1000);
    const expired = await run(
      aWriter,
      { ...args, confirmation_token: token },
      later,
    );
    expect(expired.structuredContent.error?.code).toBe("CONFIRMATION_INVALID");
    expect(await activityCount(a, "Inventario A2")).toBe(0);

    const done = await run(aWriter, { ...args, confirmation_token: token });
    expect(done.structuredContent.status).toBe("done");
    expect(await activityCount(a, "Inventario A2")).toBe(1);
  });

  it("does not accept a token earned by another connection", async () => {
    const other = await contextFor(a, a.admin.id, ["read", "write:catalog"]);
    const args = { name: "Inventario A3", idempotency_key: "key-other-3" };
    const token = (await run(aWriter, args)).structuredContent
      .confirmation_token!;

    const result = await run(other, { ...args, confirmation_token: token });
    expect(result.structuredContent.error?.code).toBe("CONFIRMATION_INVALID");
  });
});

describe("idempotency", () => {
  it("returns the same reply for the same key and arguments, without duplicating", async () => {
    const args = { name: "Inventario A4", idempotency_key: "key-idem-4" };
    const token = (await run(aWriter, args)).structuredContent
      .confirmation_token!;

    const first = await run(aWriter, { ...args, confirmation_token: token });
    const second = await run(aWriter, { ...args, confirmation_token: token });
    const retryWithoutToken = await run(aWriter, args);

    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(retryWithoutToken.structuredContent).toEqual(
      first.structuredContent,
    );
    expect(await activityCount(a, "Inventario A4")).toBe(1);
  });

  it("refuses the same key with other arguments (IDEMPOTENCY_MISMATCH)", async () => {
    const args = { name: "Inventario A5", idempotency_key: "key-idem-5" };
    const token = (await run(aWriter, args)).structuredContent
      .confirmation_token!;
    await run(aWriter, { ...args, confirmation_token: token });

    const other = { name: "Inventario A5 bis", idempotency_key: "key-idem-5" };
    const preview = await run(aWriter, other);
    expect(preview.structuredContent.error?.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("frees the key when the write fails, so a retry can run", async () => {
    const args = { name: "Inventario A2", idempotency_key: "key-dup-6" };
    const token = (await run(aWriter, args)).structuredContent
      .confirmation_token!;

    // Same name as an existing activity: the domain refuses it.
    const failed = await run(aWriter, { ...args, confirmation_token: token });
    expect(failed.structuredContent.error?.code).toBe("CONFLICT");

    const keys = await ownerDb
      .select()
      .from(mcpIdempotency)
      .where(eq(mcpIdempotency.key, "key-dup-6"));
    expect(keys).toHaveLength(0);
  });
});

describe("audit with source mcp", () => {
  it("records the domain's events as source mcp with the connection and the key", async () => {
    const args = { name: "Inventario A7", idempotency_key: "key-audit-7" };
    const token = (await run(aWriter, args)).structuredContent
      .confirmation_token!;
    const done = await run(aWriter, { ...args, confirmation_token: token });
    const ids = done.structuredContent.audit_event_ids!;

    expect(ids).toHaveLength(1);
    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, ids[0]));
    const auth = (
      aWriter as {
        http: { authInfo: { extra: { workia: { connectionId: string } } } };
      }
    ).http.authInfo.extra.workia;

    expect(event).toMatchObject({
      companyId: a.companyId,
      actorUserId: a.admin.id,
      source: "mcp",
      resourceType: "activity",
      action: "create",
    });
    expect(event.requestMeta).toMatchObject({
      path: "/api/mcp",
      method: "tools/call",
      client: "Token personal",
      connection_id: auth.connectionId,
      tool: "test_create_activity",
      idempotency_key: "key-audit-7",
      request_id: expect.any(String),
    });
  });

  it("keeps the app's own writes as source app", async () => {
    const created = await createActivity(
      a.companyId,
      { name: "Desde la app", active: true },
      a.admin.id,
    );
    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, created.id));
    expect(event.source).toBe("app");
  });

  it("logs refusals by scope or role as denied calls, not as audit events", async () => {
    const readOnly = await contextFor(a, a.admin.id, ["read"]);
    const before = await ownerDb
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents);

    const result = await run(readOnly, {
      name: "No debe",
      idempotency_key: "key-denied-8",
    });
    expect(result.structuredContent.error?.code).toBe("FORBIDDEN_SCOPE");

    const after = await ownerDb
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents);
    expect(after[0].n).toBe(before[0].n);
    const [call] = await ownerDb
      .select()
      .from(mcpToolCalls)
      .where(
        and(
          eq(mcpToolCalls.tool, "test_create_activity"),
          eq(mcpToolCalls.errorCode, "FORBIDDEN_SCOPE"),
        ),
      );
    expect(call.result).toBe("denied");
  });
});

describe("writes switch", () => {
  it("answers WRITES_DISABLED at once when off, and works again when on", async () => {
    await setMcpWritesEnabled(a.companyId, false, a.admin.id);
    try {
      const off = await run(aWriter, {
        name: "Apagado",
        idempotency_key: "key-off-9",
      });
      expect(off.structuredContent.error?.code).toBe("WRITES_DISABLED");
    } finally {
      await setMcpWritesEnabled(a.companyId, true, a.admin.id);
    }

    const on = await run(aWriter, {
      name: "Encendido",
      idempotency_key: "key-on-9",
    });
    expect(on.structuredContent.status).toBe("preview");
  });

  it("starts off in a company that never turned it on (D-17)", async () => {
    const bWriter = await contextFor(b, b.admin.id, ["read", "write:catalog"]);
    const result = await run(bWriter, {
      name: "B",
      idempotency_key: "key-b-10",
    });
    expect(result.structuredContent.error?.code).toBe("WRITES_DISABLED");
  });

  it("action:mcp/setWritesEnabledAction", async () => {
    // B's super-admin-less session cannot flip A's switch with A's form.
    actAs(b.admin, b.companyId);
    const result = await setWritesEnabledAction(
      {},
      (() => {
        const form = new FormData();
        form.set("companyId", a.companyId);
        form.set("enabled", "false");
        return form;
      })(),
    );
    expect(result.ok).toBeFalsy();
    expect((await getMcpSettings(a.companyId)).writesEnabled).toBe(true);
  });

  it("rbac:action:mcp/setWritesEnabledAction", async () => {
    const form = () => {
      const data = new FormData();
      data.set("companyId", a.companyId);
      data.set("enabled", "false");
      return data;
    };

    // admin has mcp_connections:manage but is not super_admin.
    actAs(a.admin, a.companyId);
    expect((await setWritesEnabledAction({}, form())).ok).toBeFalsy();
    expect((await getMcpSettings(a.companyId)).writesEnabled).toBe(true);

    actAs(superAdmin, a.companyId);
    expect(await setWritesEnabledAction({}, form())).toEqual({ ok: true });
    expect((await getMcpSettings(a.companyId)).writesEnabled).toBe(false);
    await setMcpWritesEnabled(a.companyId, true, a.admin.id);
  });
});

describe("atomic renewal", () => {
  it("leaves the previous contract vigente when the new one cannot be written", async () => {
    // A trigger makes the second write (the new contract) fail.
    await ownerDb.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION fail_contract_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'insert refused for the test'; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS fail_contract_insert ON contracts;
      CREATE TRIGGER fail_contract_insert BEFORE INSERT ON contracts
        FOR EACH ROW WHEN (NEW.person_id = '${a.person.id}') EXECUTE FUNCTION fail_contract_insert();
    `),
    );

    try {
      await expect(
        renewContract(
          a.companyId,
          {
            contractId: a.contract.id,
            type: "indeterminado",
            startDate: "2026-12-01",
            noticeWindow: "no_avisar",
            templateId: a.template.id,
          },
          a.admin.id,
        ),
      ).rejects.toThrow();
    } finally {
      await ownerDb.execute(
        sql.raw("DROP TRIGGER IF EXISTS fail_contract_insert ON contracts"),
      );
    }

    const [previous] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, a.contract.id));
    expect(previous.status).toBe("vigente");
    const renewEvents = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, a.contract.id),
          eq(auditEvents.action, "renew"),
        ),
      );
    expect(renewEvents).toHaveLength(0);
  });

  it("renews atomically: previous renovado, new one with previous_contract_id", async () => {
    const renewed = await renewContract(
      a.companyId,
      {
        contractId: a.contract.id,
        type: "indeterminado",
        startDate: "2026-12-01",
        noticeWindow: "no_avisar",
        templateId: a.template.id,
      },
      a.admin.id,
    );
    const [previous] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, a.contract.id));

    expect(previous.status).toBe("renovado");
    expect(renewed.previousContractId).toBe(a.contract.id);
    await expect(
      renewContract(
        a.companyId,
        {
          contractId: a.contract.id,
          type: "indeterminado",
          startDate: "2026-12-01",
          noticeWindow: "no_avisar",
          templateId: a.template.id,
        },
        a.admin.id,
      ),
    ).rejects.toThrow(/vigente/);
  });
});

describe("new infrastructure functions stay inside the company", () => {
  const key = () => ({
    connectionId: (
      aWriter as {
        http: { authInfo: { extra: { workia: { connectionId: string } } } };
      }
    ).http.authInfo.extra.workia.connectionId,
    key: "key-tenant-11",
    tool: "test_create_activity",
    argsHash: "h1",
  });

  it("lib:mcp/idempotency/reserveIdempotencyKey", async () => {
    // A's connection does not exist in company B: the composite key refuses it.
    await expect(reserveIdempotencyKey(b.companyId, key())).rejects.toThrow();
    const reserved = await reserveIdempotencyKey(a.companyId, key());
    expect(reserved.state).toBe("new");
  });

  it("lib:mcp/idempotency/completeIdempotencyKey", async () => {
    const reserved = await reserveIdempotencyKey(a.companyId, {
      ...key(),
      key: "key-tenant-12",
    });
    if (reserved.state !== "new") throw new Error("expected new");

    await completeIdempotencyKey(b.companyId, reserved.id, { hijack: true });
    const [row] = await ownerDb
      .select()
      .from(mcpIdempotency)
      .where(eq(mcpIdempotency.id, reserved.id));
    expect(row.response).toEqual({ pending: true });
  });

  it("lib:mcp/idempotency/findIdempotentReply", async () => {
    const reserved = await reserveIdempotencyKey(a.companyId, {
      ...key(),
      key: "key-tenant-13",
    });
    if (reserved.state !== "new") throw new Error("expected new");
    await completeIdempotencyKey(a.companyId, reserved.id, { status: "done" });

    expect(
      await findIdempotentReply(b.companyId, {
        ...key(),
        key: "key-tenant-13",
      }),
    ).toBeNull();
    expect(
      await findIdempotentReply(a.companyId, {
        ...key(),
        key: "key-tenant-13",
      }),
    ).toEqual({
      response: { status: "done" },
    });
  });

  it("lib:mcp/idempotency/releaseIdempotencyKey", async () => {
    const reserved = await reserveIdempotencyKey(a.companyId, {
      ...key(),
      key: "key-tenant-14",
    });
    if (reserved.state !== "new") throw new Error("expected new");

    await releaseIdempotencyKey(b.companyId, reserved.id);
    expect(
      await ownerDb
        .select()
        .from(mcpIdempotency)
        .where(eq(mcpIdempotency.id, reserved.id)),
    ).toHaveLength(1);
  });

  it("lib:mcp/settings/getMcpSettings", async () => {
    expect((await getMcpSettings(b.companyId)).writesEnabled).toBe(false);
    expect((await getMcpSettings(a.companyId)).writesEnabled).toBe(true);
  });

  it("lib:mcp/settings/setMcpWritesEnabled", async () => {
    await setMcpWritesEnabled(b.companyId, false, b.admin.id);
    expect((await getMcpSettings(a.companyId)).writesEnabled).toBe(true);
  });
});
