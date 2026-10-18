/**
 * MCP write tools (WRK-I1-6, WRK-I1-7) end to end through /api/mcp: preview,
 * confirmation, the domain write with source "mcp", and the refusals (scope,
 * role, other company, business rules). Test titles are the surface ids of
 * docs/idor-matrix.md: mcp:<tool> (company B with A's ids) and rbac:mcp:<tool>.
 */
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as mcpPost } from "@/app/api/mcp/route";
import {
  activities,
  areas,
  assetMovements,
  assets,
  auditEvents,
  contracts,
  mcpConnections,
  people,
  personSchedules,
  positionActivities,
  sites,
} from "@/lib/db/schema";
import type { McpScope } from "@/lib/mcp/scopes";
import { setMcpWritesEnabled } from "@/lib/mcp/settings";
import { generateToken } from "@/lib/mcp/tokens";

import { ownerDb, seedTenant, snapshotTenant, type Tenant } from "./fixtures";

const ORIGIN = "http://localhost:3000";
const ALL_WRITES: McpScope[] = [
  "read",
  "pii",
  "write:people",
  "write:contracts",
  "write:assets",
  "write:catalog",
];

let a: Tenant;
let b: Tenant;
const tokens: Record<string, string> = {};
let keySeq = 0;

const tokenFor = async (tenant: Tenant, userId: string, scopes: McpScope[]) => {
  const token = generateToken("pat");
  await ownerDb.insert(mcpConnections).values({
    companyId: tenant.companyId,
    userId,
    kind: "pat",
    name: `writes ${scopes.join(",")}`,
    clientName: "Grok Bot",
    scopes,
    tokenPrefix: token.prefix,
    tokenHash: token.hash,
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
  });
  return token.token;
};

type ToolResult = {
  isError?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent: Record<string, any>;
};

const call = async (
  bearer: string,
  name: string,
  args: Record<string, unknown>,
) => {
  const response = await mcpPost(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await response.text();
  const json = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
  return JSON.parse(json).result as ToolResult;
};

const code = (result: ToolResult) =>
  result.structuredContent?.error?.code ?? null;

/** Preview then confirm with the token it earned. Returns both replies. */
const confirm = async (
  bearer: string,
  name: string,
  args: Record<string, unknown>,
) => {
  const withKey = { ...args, idempotency_key: `key-${name}-${++keySeq}` };
  const preview = await call(bearer, name, withKey);

  if (preview.isError) {
    return { preview, done: preview };
  }

  const done = await call(bearer, name, {
    ...withKey,
    confirmation_token: preview.structuredContent.confirmation_token,
  });
  return { preview, done };
};

/** The audit events of a finished write, as stored. */
const eventsOf = async (result: ToolResult) => {
  const ids = (result.structuredContent.audit_event_ids ?? []) as string[];
  return Promise.all(
    ids.map(
      async (id) =>
        (
          await ownerDb.select().from(auditEvents).where(eq(auditEvents.id, id))
        )[0],
    ),
  );
};

const expectMcpAudit = async (result: ToolResult, tool: string) => {
  const events = await eventsOf(result);
  expect(events.length, `${tool} audit events`).toBeGreaterThan(0);
  for (const event of events) {
    expect(event.source).toBe("mcp");
    expect(event.requestMeta).toMatchObject({ tool, client: "Grok Bot" });
  }
};

/** Runs a refused write from company B and checks company A did not change. */
const expectRefusedWithoutEffect = async (
  bearer: string,
  name: string,
  args: Record<string, unknown>,
  expected: string,
) => {
  const before = await snapshotTenant(a);
  const { done } = await confirm(bearer, name, args);
  expect(code(done)).toBe(expected);
  expect(await snapshotTenant(a)).toEqual(before);
};

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
  await setMcpWritesEnabled(a.companyId, true, a.admin.id);
  await setMcpWritesEnabled(b.companyId, true, b.admin.id);
});

// Fresh connections per test: each one has its own 20 writes per minute.
beforeEach(async () => {
  tokens.a = await tokenFor(a, a.admin.id, ALL_WRITES);
  tokens.aNoPii = await tokenFor(
    a,
    a.admin.id,
    ALL_WRITES.filter((scope) => scope !== "pii"),
  );
  tokens.aAssetsOnly = await tokenFor(a, a.admin.id, ["read", "write:assets"]);
  tokens.aViewer = await tokenFor(a, a.viewer.id, ALL_WRITES);
  tokens.b = await tokenFor(b, b.admin.id, ALL_WRITES);
});

describe("preview never writes", () => {
  it("returns a Spanish summary and changes nothing until confirmed", async () => {
    const before = await snapshotTenant(a);
    const preview = await call(tokens.a, "return_asset", {
      asset_id: a.asset.id,
      movement_date: "2026-10-12",
      condition_note: "Bien",
      idempotency_key: "key-preview-only",
    });

    expect(preview.structuredContent).toMatchObject({
      status: "preview",
      code: "CONFIRMATION_REQUIRED",
    });
    expect(preview.structuredContent.preview.summary).toContain(
      "Devolución de «Laptop A»",
    );
    expect(preview.structuredContent.preview.summary).toContain("12/10/2026");
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("assets", () => {
  it("register_asset registers, audits as mcp and refuses a duplicate identifier", async () => {
    const { done } = await confirm(tokens.a, "register_asset", {
      name: "Moto nueva",
      identifier: "MT-NUEVA-1",
      category: "moto",
    });

    expect(done.structuredContent).toMatchObject({
      status: "done",
      asset: { status: "disponible" },
    });
    await expectMcpAudit(done, "register_asset");

    const duplicate = await confirm(tokens.a, "register_asset", {
      name: "Otra",
      identifier: "mt-nueva-1",
      category: "moto",
    });
    expect(code(duplicate.done)).toBe("CONFLICT");
  });

  it("mcp:register_asset", async () => {
    // B registers in B only; nothing of A changes.
    const before = await snapshotTenant(a);
    const { done } = await confirm(tokens.b, "register_asset", {
      name: "Moto B",
      identifier: "MT-B-1",
      category: "moto",
    });
    const [row] = await ownerDb
      .select()
      .from(assets)
      .where(eq(assets.id, done.structuredContent.asset.id));
    expect(row.companyId).toBe(b.companyId);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("rbac:mcp:register_asset", async () => {
    const { done } = await confirm(tokens.aViewer, "register_asset", {
      name: "No",
      identifier: "MT-VIEWER",
      category: "moto",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("assign_asset hands over a free asset and refuses one already assigned", async () => {
    const { done } = await confirm(tokens.a, "assign_asset", {
      asset_id: a.freeAsset.id,
      person_id: a.teammate.id,
      movement_date: "2026-10-12",
      condition_note: "Nueva",
    });

    expect(done.structuredContent).toMatchObject({
      status: "done",
      asset: { status: "asignado", holder: { id: a.teammate.id } },
      movement_id: expect.any(String),
    });
    await expectMcpAudit(done, "assign_asset");

    const again = await confirm(tokens.a, "assign_asset", {
      asset_id: a.freeAsset.id,
      person_id: a.person.id,
      movement_date: "2026-10-13",
      condition_note: "Nueva",
    });
    expect(code(again.done)).toBe("CONFLICT");
  });

  it("mcp:assign_asset", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "assign_asset",
      {
        asset_id: a.asset.id,
        person_id: b.person.id,
        movement_date: "2026-10-12",
        condition_note: "x",
      },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:assign_asset", async () => {
    const { done } = await confirm(tokens.aViewer, "assign_asset", {
      asset_id: a.freeAsset.id,
      person_id: a.person.id,
      movement_date: "2026-10-12",
      condition_note: "x",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("return_asset returns an assigned asset and refuses a free one", async () => {
    const { done } = await confirm(tokens.a, "return_asset", {
      asset_id: a.freeAsset.id,
      movement_date: "2026-10-14",
      condition_note: "Con rayones",
    });
    expect(done.structuredContent).toMatchObject({
      status: "done",
      asset: { status: "disponible" },
    });
    await expectMcpAudit(done, "return_asset");

    const [movement] = await ownerDb
      .select()
      .from(assetMovements)
      .where(eq(assetMovements.id, done.structuredContent.movement_id));
    expect(movement).toMatchObject({
      type: "devolucion",
      conditionNote: "Con rayones",
    });

    const again = await confirm(tokens.a, "return_asset", {
      asset_id: a.freeAsset.id,
      movement_date: "2026-10-15",
      condition_note: "x",
    });
    expect(code(again.done)).toBe("CONFLICT");
  });

  it("mcp:return_asset", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "return_asset",
      {
        asset_id: a.asset.id,
        movement_date: "2026-10-12",
        condition_note: "x",
      },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:return_asset", async () => {
    const { done } = await confirm(tokens.aViewer, "return_asset", {
      asset_id: a.asset.id,
      movement_date: "2026-10-12",
      condition_note: "x",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });
});

describe("catalog", () => {
  it("create_catalog_item creates each kind and refuses normalized duplicates", async () => {
    for (const [kind, extra] of [
      ["area", {}],
      ["position", { area_id: a.area.id }],
      ["activity", {}],
      ["site", { site_kind: "sucursal" }],
    ] as const) {
      const { done } = await confirm(tokens.a, "create_catalog_item", {
        kind,
        name: `Nuevo ${kind} Tapachula`,
        ...extra,
      });
      expect(done.structuredContent, kind).toMatchObject({
        status: "done",
        item: { kind },
      });
      await expectMcpAudit(done, "create_catalog_item");
    }

    // Same name with other case, accents and spaces.
    const duplicate = await confirm(tokens.a, "create_catalog_item", {
      kind: "site",
      name: "  sucursal   a ",
      site_kind: "sucursal",
    });
    expect(code(duplicate.done)).toBe("CONFLICT");

    const noKind = await confirm(tokens.a, "create_catalog_item", {
      kind: "site",
      name: "Sin tipo",
    });
    expect(code(noKind.done)).toBe("VALIDATION");
  });

  it("mcp:create_catalog_item", async () => {
    // A parent area of company A is not found from company B.
    await expectRefusedWithoutEffect(
      tokens.b,
      "create_catalog_item",
      { kind: "position", name: "Puesto cruzado", area_id: a.area.id },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:create_catalog_item", async () => {
    const { done } = await confirm(tokens.aViewer, "create_catalog_item", {
      kind: "area",
      name: "Viewer",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("link and unlink an activity, warning about people in the position", async () => {
    const [activity] = await ownerDb
      .insert(activities)
      .values({ companyId: a.companyId, name: "Cobranza A" })
      .returning();

    const linked = await confirm(tokens.a, "link_position_activity", {
      position_id: a.position.id,
      activity_id: activity.id,
    });
    expect(linked.done.structuredContent).toMatchObject({
      status: "done",
      changed: true,
    });
    expect(linked.done.structuredContent.position.activities).toContain(
      "Cobranza A",
    );

    const unlinked = await confirm(tokens.a, "unlink_position_activity", {
      position_id: a.position.id,
      activity_id: activity.id,
    });
    expect(unlinked.preview.structuredContent.preview.warnings[0]).toMatch(
      /persona activa tiene este puesto/,
    );
    expect(unlinked.done.structuredContent).toMatchObject({
      status: "done",
      changed: true,
    });
    await expectMcpAudit(unlinked.done, "unlink_position_activity");

    const links = await ownerDb
      .select()
      .from(positionActivities)
      .where(eq(positionActivities.activityId, activity.id));
    expect(links).toHaveLength(0);
    // The activity itself stays in the catalog.
    expect(
      await ownerDb
        .select()
        .from(activities)
        .where(eq(activities.id, activity.id)),
    ).toHaveLength(1);
  });

  it("mcp:link_position_activity", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "link_position_activity",
      { position_id: a.position.id, activity_id: b.activity.id },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:link_position_activity", async () => {
    const { done } = await confirm(tokens.aViewer, "link_position_activity", {
      position_id: a.position.id,
      activity_id: a.activity.id,
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("mcp:unlink_position_activity", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "unlink_position_activity",
      { position_id: a.position.id, activity_id: a.activity.id },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:unlink_position_activity", async () => {
    const { done } = await confirm(tokens.aViewer, "unlink_position_activity", {
      position_id: a.position.id,
      activity_id: a.activity.id,
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });
});

describe("contracts", () => {
  it("issue_contract refuses a person with a vigente contract and needs end_date for determinado", async () => {
    const withVigente = await confirm(tokens.a, "issue_contract", {
      person_id: a.person.id,
      type: "indeterminado",
      start_date: "2026-12-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });
    expect(code(withVigente.done)).toBe("CONFLICT");

    const noEnd = await confirm(tokens.a, "issue_contract", {
      person_id: a.teammate.id,
      type: "determinado",
      start_date: "2026-12-01",
      notice_window: "1",
      template_id: a.template.id,
    });
    expect(code(noEnd.done)).toBe("VALIDATION");
  });

  it("issue_contract emits with the frozen text and reports missing tokens", async () => {
    const { preview, done } = await confirm(tokens.a, "issue_contract", {
      person_id: a.teammate.id,
      type: "determinado",
      start_date: "2026-12-01",
      end_date: "2027-02-28",
      notice_window: "1",
      template_id: a.template.id,
    });

    expect(preview.structuredContent.preview.summary).toContain("01/12/2026");
    expect(done.structuredContent).toMatchObject({
      status: "done",
      contract: { status: "vigente" },
    });
    const [row] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, done.structuredContent.contract.id));
    expect(row.generatedText).toBe("Contrato de Compañera A");
    await expectMcpAudit(done, "issue_contract");
  });

  it("mcp:issue_contract", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "issue_contract",
      {
        person_id: a.teammate.id,
        type: "indeterminado",
        start_date: "2026-12-01",
        notice_window: "no_avisar",
        template_id: b.template.id,
      },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:issue_contract", async () => {
    const { done } = await confirm(tokens.aViewer, "issue_contract", {
      person_id: a.teammate.id,
      type: "indeterminado",
      start_date: "2026-12-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("a connection with only write:assets cannot renew (FORBIDDEN_SCOPE)", async () => {
    const { done } = await confirm(tokens.aAssetsOnly, "renew_contract", {
      contract_id: a.contract.id,
      type: "indeterminado",
      start_date: "2026-12-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });
    expect(code(done)).toBe("FORBIDDEN_SCOPE");
  });

  it("mcp:renew_contract", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "renew_contract",
      {
        contract_id: a.contract.id,
        type: "indeterminado",
        start_date: "2026-12-01",
        notice_window: "no_avisar",
        template_id: b.template.id,
      },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:renew_contract", async () => {
    const { done } = await confirm(tokens.aViewer, "renew_contract", {
      contract_id: a.contract.id,
      type: "indeterminado",
      start_date: "2026-12-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("mcp:mark_contract_no_renew", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "mark_contract_no_renew",
      { contract_id: a.contract.id, motivo: "x" },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:mark_contract_no_renew", async () => {
    const { done } = await confirm(tokens.aViewer, "mark_contract_no_renew", {
      contract_id: a.contract.id,
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("renew_contract renews a vigente contract and then refuses it", async () => {
    const { done } = await confirm(tokens.a, "renew_contract", {
      contract_id: a.contract.id,
      type: "indeterminado",
      start_date: "2026-12-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });

    expect(done.structuredContent).toMatchObject({
      status: "done",
      previous: { id: a.contract.id, status: "renovado" },
      contract: { type: "indeterminado", status: "vigente" },
    });
    const [renewed] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, done.structuredContent.contract.id));
    expect(renewed.previousContractId).toBe(a.contract.id);
    expect(renewed.scheduleEntrada).toBe("09:00");
    expect(done.structuredContent.audit_event_ids).toHaveLength(2);
    await expectMcpAudit(done, "renew_contract");

    const again = await confirm(tokens.a, "renew_contract", {
      contract_id: a.contract.id,
      type: "indeterminado",
      start_date: "2027-01-01",
      notice_window: "no_avisar",
      template_id: a.template.id,
    });
    expect(code(again.done)).toBe("CONFLICT");
  });

  it("mark_contract_no_renew takes it out of the tray with the reason in the audit", async () => {
    const [current] = await ownerDb
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.personId, a.person.id),
          eq(contracts.status, "vigente"),
        ),
      );
    const { done } = await confirm(tokens.a, "mark_contract_no_renew", {
      contract_id: current.id,
      motivo: "Evaluación no aprobada",
    });

    expect(done.structuredContent).toMatchObject({
      status: "done",
      contract: { status: "no_renovado" },
    });
    const [event] = await eventsOf(done);
    expect(event.payload).toMatchObject({
      summary: expect.stringContaining("Motivo: Evaluación no aprobada"),
    });
  });
});

describe("people", () => {
  it("create_person creates with the app's rules; RFC/CURP/NSS only with pii", async () => {
    const withoutPii = await confirm(tokens.aNoPii, "create_person", {
      nombres: "Nueva",
      apellido_paterno: "Persona",
      curp: "PEPN900101MCSRRV09",
    });
    expect(code(withoutPii.done)).toBe("FORBIDDEN_SCOPE");

    const invalid = await confirm(tokens.a, "create_person", {
      nombres: "Nueva",
      apellido_paterno: "Persona",
      rfc: "MAL",
    });
    expect(code(invalid.done)).toBe("VALIDATION");

    const { done } = await confirm(tokens.a, "create_person", {
      nombres: "Nueva",
      apellido_paterno: "Persona",
      fecha_ingreso: "2026-10-12",
      site_id: a.site.id,
    });
    expect(done.structuredContent).toMatchObject({
      status: "done",
      person: { status: "activa" },
    });
    await expectMcpAudit(done, "create_person");
  });

  it("mcp:create_person", async () => {
    // A site of company A is not usable from company B.
    await expectRefusedWithoutEffect(
      tokens.b,
      "create_person",
      { nombres: "Cruzada", apellido_paterno: "B", site_id: a.site.id },
      "CONFLICT",
    );
  });

  it("rbac:mcp:create_person", async () => {
    const { done } = await confirm(tokens.aViewer, "create_person", {
      nombres: "V",
      apellido_paterno: "V",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("update_person changes only the sent fields and keeps the schedule and status", async () => {
    const { preview, done } = await confirm(tokens.a, "update_person", {
      person_id: a.person.id,
      changes: { telefono: "9611234567", site_id: null },
    });

    expect(preview.structuredContent.preview.summary).toContain(
      "telefono, site_id",
    );
    expect(done.structuredContent.changes).toMatchObject({
      telefono: { to: "9611234567" },
      site_id: { to: null },
    });
    const [row] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, a.person.id));
    expect(row).toMatchObject({
      telefono: "9611234567",
      siteId: null,
      status: "activa",
      rfc: a.person.rfc,
    });
    const [schedule] = await ownerDb
      .select()
      .from(personSchedules)
      .where(eq(personSchedules.personId, a.person.id));
    expect(schedule.entrada).toBe("09:00");
    await expectMcpAudit(done, "update_person");

    const statusChange = await call(tokens.a, "update_person", {
      person_id: a.person.id,
      changes: { status: "baja" },
      idempotency_key: "key-status-in-update",
    });
    expect(statusChange.isError).toBe(true);
  });

  it("mcp:update_person", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "update_person",
      { person_id: a.person.id, changes: { telefono: "000" } },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:update_person", async () => {
    const { done } = await confirm(tokens.aViewer, "update_person", {
      person_id: a.person.id,
      changes: { telefono: "000" },
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("set_person_status records a baja with warnings and a reactivation", async () => {
    const { preview, done } = await confirm(tokens.a, "set_person_status", {
      person_id: a.person.id,
      status: "baja",
      motivo: "Renuncia",
    });

    expect(preview.structuredContent.preview.warnings.join(" ")).toMatch(
      /activo/,
    );
    expect(done.structuredContent).toMatchObject({
      status: "done",
      person: { status: "baja" },
    });
    const [event] = await eventsOf(done);
    expect(event).toMatchObject({ action: "baja", source: "mcp" });

    const back = await confirm(tokens.a, "set_person_status", {
      person_id: a.person.id,
      status: "activa",
    });
    const [reactivation] = await eventsOf(back.done);
    expect(reactivation.action).toBe("reactivate");

    const same = await confirm(tokens.a, "set_person_status", {
      person_id: a.person.id,
      status: "activa",
    });
    expect(code(same.done)).toBe("CONFLICT");
  });

  it("mcp:set_person_status", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "set_person_status",
      { person_id: a.person.id, status: "baja" },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:set_person_status", async () => {
    const { done } = await confirm(tokens.aViewer, "set_person_status", {
      person_id: a.person.id,
      status: "baja",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });

  it("update_person_schedule changes the schedule and leaves issued contracts alone", async () => {
    const { done } = await confirm(tokens.a, "update_person_schedule", {
      person_id: a.person.id,
      entrada: "08:00",
      salida: "17:00",
    });

    expect(done.structuredContent).toMatchObject({
      status: "done",
      horario: { entrada: "08:00", salida: "17:00" },
    });
    const [schedule] = await ownerDb
      .select()
      .from(personSchedules)
      .where(eq(personSchedules.personId, a.person.id));
    expect(schedule).toMatchObject({ entrada: "08:00", salida: "17:00" });
    const [latest] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.personId, a.person.id))
      .orderBy(desc(contracts.createdAt))
      .limit(1);
    expect(latest.scheduleEntrada).toBe("09:00");
    await expectMcpAudit(done, "update_person_schedule");

    const bad = await call(tokens.a, "update_person_schedule", {
      person_id: a.person.id,
      entrada: "25:00",
      idempotency_key: "key-bad-time",
    });
    expect(bad.isError).toBe(true);
  });

  it("mcp:update_person_schedule", async () => {
    await expectRefusedWithoutEffect(
      tokens.b,
      "update_person_schedule",
      { person_id: a.person.id, entrada: "07:00" },
      "NOT_FOUND",
    );
  });

  it("rbac:mcp:update_person_schedule", async () => {
    const { done } = await confirm(tokens.aViewer, "update_person_schedule", {
      person_id: a.person.id,
      entrada: "07:00",
    });
    expect(code(done)).toBe("FORBIDDEN_RBAC");
  });
});

describe("ChatGPT never writes", () => {
  it("answers FORBIDDEN_SCOPE with the message that sends to Grok Bot or the app", async () => {
    const token = generateToken("pat");
    await ownerDb.insert(mcpConnections).values({
      companyId: a.companyId,
      userId: a.admin.id,
      kind: "oauth",
      name: "ChatGPT",
      clientName: "ChatGPT",
      isChatgpt: true,
      // Even if write scopes were stored, the ceiling removes them.
      scopes: ["read", "write:assets"],
      tokenPrefix: token.prefix.replace("workia_pat_", "workia_at_"),
      tokenHash: token.hash,
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const access = generateToken("access");
    await ownerDb
      .update(mcpConnections)
      .set({ tokenPrefix: access.prefix, tokenHash: access.hash })
      .where(eq(mcpConnections.tokenHash, token.hash));

    const { done } = await confirm(access.token, "assign_asset", {
      asset_id: a.asset.id,
      person_id: a.person.id,
      movement_date: "2026-10-12",
      condition_note: "x",
    });
    expect(code(done)).toBe("FORBIDDEN_SCOPE");
    expect(done.structuredContent.error.message).toMatch(/Grok Bot o la app/);
  });
});

describe("nothing leaks into company A's other tables", () => {
  it("B's writes landed only in B", async () => {
    for (const table of [areas, sites, assets]) {
      const rows = await ownerDb
        .select()
        .from(table)
        .where(eq(table.companyId, a.companyId));
      expect(rows.some((row) => row.name.includes("cruzad"))).toBe(false);
    }
  });
});

describe("domain query used by the write tools", () => {
  it("lib:people/countActivePeopleInPosition", async () => {
    const { countActivePeopleInPosition } = await import("@/lib/people");

    expect(await countActivePeopleInPosition(b.companyId, a.position.id)).toBe(
      0,
    );
    expect(
      await countActivePeopleInPosition(a.companyId, a.position.id),
    ).toBeGreaterThan(0);
  });
});

describe("expediente México writes (WRK-I1-9)", () => {
  it("needs pii to write México data, and stores it with the app's schema", async () => {
    const without = await confirm(tokens.aNoPii, "create_person", {
      nombres: "Con",
      apellido_paterno: "Domicilio",
      domicilio_calle: "Av. Siempre Viva",
    });
    expect(code(without.done)).toBe("FORBIDDEN_SCOPE");

    const badZip = await confirm(tokens.a, "create_person", {
      nombres: "Con",
      apellido_paterno: "Domicilio",
      domicilio_codigo_postal: "123",
    });
    expect(code(badZip.done)).toBe("VALIDATION");

    const { done } = await confirm(tokens.a, "create_person", {
      nombres: "Con",
      apellido_paterno: "Domicilio",
      domicilio_calle: "Av. Siempre Viva",
      domicilio_codigo_postal: "29010",
      domicilio_estado: "Chiapas",
      estado_civil: "soltero",
      beneficiarios: [
        { nombre: "Madre", parentesco: "Madre", porcentaje: 100 },
      ],
    });
    expect(done.structuredContent.status).toBe("done");
    const [row] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, done.structuredContent.person.id));
    expect(row).toMatchObject({
      domicilioCalle: "Av. Siempre Viva",
      domicilioCodigoPostal: "29010",
      estadoCivil: "soltero",
    });

    const edit = await confirm(tokens.a, "update_person", {
      person_id: row.id,
      changes: { domicilio_colonia: "Centro", beneficiarios: null },
    });
    expect(edit.done.structuredContent.status).toBe("done");
    const [after] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, row.id));
    expect(after).toMatchObject({
      domicilioCalle: "Av. Siempre Viva",
      domicilioColonia: "Centro",
    });
  });
});
