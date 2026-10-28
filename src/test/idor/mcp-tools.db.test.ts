/**
 * Workia MCP read tools (WRK-I1-2) against a real database: every tool from a
 * company B connection never sees company A, PII is masked without the pii
 * scope, cursors are signed, and the lists match the app's own queries.
 * Test titles are the surface ids of docs/idor-matrix.md.
 */
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as mcpPost } from "@/app/api/mcp/route";
import { listAuditEventsKeyset } from "@/lib/audit";
import {
  createContract,
  createContractTemplate,
  listContractsKeyset,
  listExpiringContracts,
  listRenewalTrayItems,
  previewContract,
} from "@/lib/contracts";
import {
  auditEvents,
  contracts,
  employmentPeriods,
  mcpConnections,
  mcpToolCalls,
  people,
  personBeneficiaries,
  personSchedules,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import {
  vacationEntitlementForPerson,
  vacationToolFields,
} from "@/lib/people/vacation-card";
import type { McpScope } from "@/lib/mcp/scopes";
import { generateToken } from "@/lib/mcp/tokens";
import { listPeopleKeyset } from "@/lib/people";
import { createRegion } from "@/lib/regions";
import { createTerminationReason } from "@/lib/termination-reasons";
import { onboardings } from "@/lib/db/schema";
import { setSiteRegion } from "@/lib/sites";
import { listAssetsKeyset } from "@/lib/resguardo";

import { idsIn, ownerDb, seedTenant, tenantIds, type Tenant } from "./fixtures";

const ORIGIN = "http://localhost:3000";

let a: Tenant;
let b: Tenant;
const tokens: Record<string, string> = {};

/** A connection inserted directly (any role), as the endpoint would see it. */
const tokenFor = async (tenant: Tenant, userId: string, scopes: McpScope[]) => {
  const token = generateToken("pat");
  const [row] = await ownerDb
    .insert(mcpConnections)
    .values({
      companyId: tenant.companyId,
      userId,
      kind: "pat",
      name: `test ${scopes.join(",")}`,
      clientName: "Token personal",
      scopes,
      tokenPrefix: token.prefix,
      tokenHash: token.hash,
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return { token: token.token, connectionId: row.id };
};

const rpc = async (
  bearer: string,
  method: string,
  params: Record<string, unknown> = {},
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
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
  return JSON.parse(json);
};

type ToolResult = {
  isError?: boolean;
  // Tool payloads are checked field by field in each test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent: Record<string, any>;
  content: { text: string }[];
};

const call = async (
  bearer: string,
  name: string,
  args: Record<string, unknown> = {},
) =>
  (await rpc(bearer, "tools/call", { name, arguments: args }))
    .result as ToolResult;

const errorCode = (result: ToolResult) =>
  result.structuredContent?.error?.code ?? null;

/** No id of company A in what company B got back. */
const expectNoLeak = (value: unknown) => {
  const leaked = idsIn(value).filter(
    (id) => tenantIds(a).has(id) || id === a.companyId,
  );
  expect(leaked).toEqual([]);
};

const RFC_A = () => a.person.rfc!;
const CURP_A = () => a.person.curp!;

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");

  tokens.aRead = (await tokenFor(a, a.admin.id, ["read"])).token;
  tokens.aAll = (await tokenFor(a, a.admin.id, ["read", "audit", "pii"])).token;
  tokens.aAudit = (await tokenFor(a, a.admin.id, ["read", "audit"])).token;
  tokens.aViewerAudit = (
    await tokenFor(a, a.viewer.id, ["read", "audit"])
  ).token;
  tokens.bAll = (await tokenFor(b, b.admin.id, ["read", "audit", "pii"])).token;

  // The contract text carries the RFC, as the real templates do.
  await ownerDb
    .update(contracts)
    .set({
      generatedText: `Contrato de Persona A con RFC ${a.person.rfc} y CURP ${a.person.curp}.`,
    })
    .where(eq(contracts.id, a.contract.id));
  // Expediente México (WRK-I1-9): address, INE and a beneficiary.
  await ownerDb
    .update(people)
    .set({
      domicilioCalle: "Calle Secreta 77",
      domicilioCodigoPostal: "29000",
      domicilioEstado: "Chiapas",
      estadoCivil: "casado",
      ineClaveElector: "SECRETOINE00000001",
    })
    .where(eq(people.id, a.person.id));
  await ownerDb.insert(personBeneficiaries).values({
    companyId: a.companyId,
    personId: a.person.id,
    nombre: "Beneficiaria Secreta",
    parentesco: "Madre",
    porcentaje: "100.00",
  });
  // An audit event whose payload carries PII.
  await ownerDb.insert(auditEvents).values({
    companyId: a.companyId,
    actorUserId: a.admin.id,
    resourceType: "person",
    resourceId: a.person.id,
    action: "update",
    source: "app",
    payload: {
      summary: "Edición",
      before: { rfc: a.person.rfc, curp: a.person.curp },
      changes: { nss: { from: a.person.nss, to: "99999999999" } },
    },
  });
});

describe("protocol surface", () => {
  it("lists the 39 tools, the 4 resources and the 3 prompts", async () => {
    const tools = (await rpc(tokens.aRead, "tools/list")).result.tools;
    const resources = (await rpc(tokens.aRead, "resources/list")).result
      .resources;
    const templates = (await rpc(tokens.aRead, "resources/templates/list"))
      .result.resourceTemplates;
    const prompts = (await rpc(tokens.aRead, "prompts/list")).result.prompts;

    // 18 reads (phase 1) + 13 writes (phase 2) + phase 3 (3 reads, 4 writes)
    // + list_termination_reasons (Iniciativa 2)
    // + get_vacation_entitlement (WRK-I14-2).
    expect(tools).toHaveLength(40);
    expect(resources.map((r: { uri: string }) => r.uri).sort()).toEqual([
      "workia://catalogo",
      "workia://glosario",
      "workia://plantillas/tokens",
    ]);
    expect(
      templates.map((t: { uriTemplate: string }) => t.uriTemplate),
    ).toEqual(["workia://plantillas/{id}"]);
    expect(prompts.map((p: { name: string }) => p.name).sort()).toEqual([
      "baja_checklist",
      "resumen_expediente",
      "revisar_bandeja_renovacion",
    ]);
    // No tool takes a company (addendum §3).
    expect(
      JSON.stringify(tools.map((t: { inputSchema: unknown }) => t.inputSchema)),
    ).not.toMatch(/company_?id/i);
  });

  it("returns structuredContent and the same JSON as text", async () => {
    const result = await call(tokens.aRead, "list_sites");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
  });

  it("reads resources within the company only", async () => {
    const catalog = await rpc(tokens.bAll, "resources/read", {
      uri: "workia://catalogo",
    });
    expectNoLeak(catalog);
    expect(catalog.result.contents[0].text).toContain(b.position.name);

    const foreignTemplate = await rpc(tokens.bAll, "resources/read", {
      uri: `workia://plantillas/${a.template.id}`,
    });
    expect(foreignTemplate.result.contents[0].text).toContain("NOT_FOUND");
    expect(foreignTemplate.result.contents[0].text).not.toContain(
      "Contrato de",
    );

    const ownTemplate = await rpc(tokens.aRead, "resources/read", {
      uri: `workia://plantillas/${a.template.id}`,
    });
    expect(ownTemplate.result.contents[0].text).toBe(a.template.body);
  });
});

describe("people", () => {
  it("mcp:list_people", async () => {
    const result = await call(tokens.bAll, "list_people", { limit: 100 });
    expectNoLeak(result);

    const own = await call(tokens.aRead, "list_people", { limit: 100 });
    expect(
      own.structuredContent.items.map((item: { id: string }) => item.id),
    ).toContain(a.person.id);
    expect(
      own.structuredContent.items[0].fecha_ingreso_mx === null ||
        /\d{2}\/\d{2}\/\d{4}/.test(
          own.structuredContent.items[0].fecha_ingreso_mx,
        ),
    ).toBe(true);
  });

  it("filters people with nothing captured, revealing presence only (D-14)", async () => {
    const result = await call(tokens.aRead, "list_people", {
      missing: ["horario"],
      limit: 100,
    });
    const ids = result.structuredContent.items.map(
      (item: { id: string }) => item.id,
    );

    // The person has a schedule; the teammate has none.
    expect(ids).toContain(a.teammate.id);
    expect(ids).not.toContain(a.person.id);

    const bySite = await call(tokens.aRead, "list_people", {
      site_id: a.site.id,
      missing: ["horario", "nss"],
    });
    expect(bySite.structuredContent.items).toEqual([]);

    // An empty schedule row (no times) still counts as missing.
    await ownerDb
      .update(personSchedules)
      .set({ entrada: null })
      .where(eq(personSchedules.id, a.schedule.id));
    try {
      const empty = await call(tokens.aRead, "list_people", {
        missing: ["horario"],
        limit: 100,
      });
      expect(
        empty.structuredContent.items.map((item: { id: string }) => item.id),
      ).toContain(a.person.id);
    } finally {
      await ownerDb
        .update(personSchedules)
        .set({ entrada: "09:00" })
        .where(eq(personSchedules.id, a.schedule.id));
    }
  });

  it("does not search by RFC or CURP without the pii scope", async () => {
    const masked = await call(tokens.aRead, "list_people", { query: RFC_A() });
    expect(masked.structuredContent.items).toEqual([]);

    const unmasked = await call(tokens.aAll, "list_people", {
      query: CURP_A(),
    });
    expect(
      unmasked.structuredContent.items.map((item: { id: string }) => item.id),
    ).toEqual([a.person.id]);
  });

  it("pages with a signed cursor and refuses it under other filters", async () => {
    const first = await call(tokens.aRead, "list_people", { limit: 1 });
    expect(first.structuredContent.items).toHaveLength(1);
    expect(first.structuredContent.next_cursor).toBeTruthy();

    const second = await call(tokens.aRead, "list_people", {
      limit: 1,
      cursor: first.structuredContent.next_cursor,
    });
    expect(second.structuredContent.items[0].id).not.toBe(
      first.structuredContent.items[0].id,
    );

    const mismatch = await call(tokens.aRead, "list_people", {
      limit: 1,
      status: "activa",
      cursor: first.structuredContent.next_cursor,
    });
    expect(errorCode(mismatch)).toBe("VALIDATION");

    // Arguments outside the input schema are refused by the SDK before the tool runs.
    expect(
      (await call(tokens.aRead, "list_people", { limit: 101 })).isError,
    ).toBe(true);
  });

  it("mcp:get_person", async () => {
    const foreign = await call(tokens.bAll, "get_person", {
      person_id: a.person.id,
    });
    expect(errorCode(foreign)).toBe("NOT_FOUND");

    const masked = await call(tokens.aRead, "get_person", {
      person_id: a.person.id,
      include: ["horario", "contratos", "activos", "actividades"],
    });
    const person = masked.structuredContent.person;
    expect(person.pii_masked).toBe(true);
    expect(person.rfc).toBe(
      `${RFC_A().slice(0, 4)}${"•".repeat(RFC_A().length - 4)}`,
    );
    expect(JSON.stringify(masked)).not.toContain(RFC_A());
    expect(JSON.stringify(masked)).not.toContain(CURP_A());
    expect(JSON.stringify(masked)).not.toContain(a.person.nss!);
    expect(masked.structuredContent.horario.entrada).toBe("09:00");
    expect(
      masked.structuredContent.contratos.map((c: { id: string }) => c.id),
    ).toContain(a.contract.id);
    expect(
      masked.structuredContent.activos.map((x: { id: string }) => x.id),
    ).toContain(a.asset.id);
    expect(masked.structuredContent.actividades).toContain(a.activity.name);

    const clear = await call(tokens.aAll, "get_person", {
      person_id: a.person.id,
    });
    expect(clear.structuredContent.person).toMatchObject({
      rfc: RFC_A(),
      pii_masked: false,
    });

    const [log] = await ownerDb
      .select()
      .from(mcpToolCalls)
      .where(
        and(
          eq(mcpToolCalls.companyId, a.companyId),
          eq(mcpToolCalls.tool, "get_person"),
        ),
      )
      .orderBy(desc(mcpToolCalls.occurredAt))
      .limit(1);
    expect(log.piiUnmasked).toBe(true);
  });
});

describe("search and fetch", () => {
  it("mcp:search", async () => {
    const foreign = await call(tokens.bAll, "search", { query: "Persona A" });
    expectNoLeak(foreign);

    const own = await call(tokens.aAll, "search", { query: "Persona A" });
    const results = own.structuredContent.results as Array<
      Record<string, string>
    >;
    expect(results.map((r) => r.id)).toContain(`person:${a.person.id}`);
    expect(results.map((r) => r.id)).toContain(`contract:${a.contract.id}`);
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual([
        "id",
        "text",
        "title",
        "url",
      ]);
      expect(result.text).not.toContain(RFC_A());
      expect(result.text).not.toContain(CURP_A());
    }

    // Even with pii, search never matches by RFC (no oracle).
    expect(
      (await call(tokens.aAll, "search", { query: RFC_A() })).structuredContent
        .results,
    ).toEqual([]);

    const asset = await call(tokens.aRead, "search", {
      query: a.asset.identifier,
    });
    expect(asset.structuredContent.results[0].id).toBe(`asset:${a.asset.id}`);
  });

  it("mcp:fetch", async () => {
    for (const id of [
      `person:${a.person.id}`,
      `contract:${a.contract.id}`,
      `asset:${a.asset.id}`,
      `site:${a.site.id}`,
    ]) {
      expect(errorCode(await call(tokens.bAll, "fetch", { id }))).toBe(
        "NOT_FOUND",
      );
    }

    const person = await call(tokens.aRead, "fetch", {
      id: `person:${a.person.id}`,
    });
    expect(Object.keys(person.structuredContent).sort()).toEqual([
      "id",
      "metadata",
      "text",
      "title",
      "url",
    ]);
    expect(person.structuredContent.text).not.toContain(RFC_A());
    expect(person.structuredContent.metadata.pii_masked).toBe(true);

    const contract = await call(tokens.aRead, "fetch", {
      id: `contract:${a.contract.id}`,
    });
    expect(contract.structuredContent.text).toContain("Contrato de Persona A");
    expect(contract.structuredContent.text).not.toContain(RFC_A());

    expect(
      (await call(tokens.aRead, "fetch", { id: "users:123" })).isError,
    ).toBe(true);
  });
});

describe("catalog", () => {
  it("mcp:list_areas", async () => {
    expectNoLeak(await call(tokens.bAll, "list_areas"));
    const own = await call(tokens.aRead, "list_areas");
    expect(own.isError).toBeFalsy();
    expect(own.structuredContent.items.length).toBeGreaterThan(0);
  });

  it("mcp:list_positions", async () => {
    expectNoLeak(await call(tokens.bAll, "list_positions"));
    const own = await call(tokens.aRead, "list_positions");
    expect(own.isError).toBeFalsy();
    expect(own.structuredContent.items.length).toBeGreaterThan(0);
  });

  it("mcp:list_activities", async () => {
    expectNoLeak(await call(tokens.bAll, "list_activities"));
    const own = await call(tokens.aRead, "list_activities");
    expect(own.isError).toBeFalsy();
    expect(own.structuredContent.items.length).toBeGreaterThan(0);
  });

  it("mcp:list_sites", async () => {
    expectNoLeak(await call(tokens.bAll, "list_sites"));
    const own = await call(tokens.aRead, "list_sites");
    expect(own.isError).toBeFalsy();
    expect(own.structuredContent.items.length).toBeGreaterThan(0);
  });

  it("mcp:list_termination_reasons", async () => {
    const reason = await createTerminationReason(
      a.companyId,
      { name: "Motivo MCP A", classification: "otra", active: true },
      a.admin.id,
    );

    const other = await call(tokens.bAll, "list_termination_reasons");
    expect(JSON.stringify(other)).not.toContain(reason.id);

    const own = await call(tokens.aRead, "list_termination_reasons");
    expect(own.structuredContent.items).toContainEqual({
      id: reason.id,
      name: "Motivo MCP A",
      active: true,
    });
  });

  it("mcp:list_regions", async () => {
    const region = await createRegion(
      a.companyId,
      { name: "Región MCP A", active: true },
      a.admin.id,
    );
    await setSiteRegion(a.companyId, a.site.id, region.id, a.admin.id);

    const other = await call(tokens.bAll, "list_regions");
    expect(JSON.stringify(other)).not.toContain(region.id);

    const own = await call(tokens.aRead, "list_regions");
    expect(own.structuredContent.items).toContainEqual({
      id: region.id,
      name: "Región MCP A",
      active: true,
      sucursales: [{ id: a.site.id, name: a.site.name }],
    });

    // region_id filters: sites, people (by their site) and the renewal tray.
    const sitesInRegion = await call(tokens.aRead, "list_sites", {
      region_id: region.id,
    });
    expect(
      sitesInRegion.structuredContent.items.map(
        (site: { id: string }) => site.id,
      ),
    ).toEqual([a.site.id]);

    await ownerDb
      .update(people)
      .set({ siteId: a.site.id })
      .where(eq(people.id, a.person.id));
    const peopleInRegion = await call(tokens.aRead, "list_people", {
      region_id: region.id,
    });
    expect(
      peopleInRegion.structuredContent.items.map(
        (person: { id: string }) => person.id,
      ),
    ).toEqual([a.person.id]);

    // Company B asking with A's region gets nothing.
    const crossPeople = await call(tokens.bAll, "list_people", {
      region_id: region.id,
    });
    expect(crossPeople.structuredContent.items).toEqual([]);
    const crossTray = await call(tokens.bAll, "list_renewal_tray", {
      region_id: region.id,
    });
    expect(crossTray.structuredContent.count).toBe(0);
    const crossExpiring = await call(tokens.bAll, "list_expiring_contracts", {
      region_id: region.id,
      within_days: 365,
    });
    expect(crossExpiring.structuredContent.items).toEqual([]);
  });

  it("lists positions with their activities", async () => {
    const result = await call(tokens.aRead, "list_positions", {
      area_id: a.area.id,
    });
    expect(result.structuredContent.items[0]).toMatchObject({
      id: a.position.id,
      activities: [a.activity.name],
    });
  });
});

describe("contracts", () => {
  it("mcp:list_contracts", async () => {
    expectNoLeak(await call(tokens.bAll, "list_contracts", { limit: 100 }));
    const own = await call(tokens.aRead, "list_contracts", {
      status: ["vigente"],
      type: "determinado",
    });
    expect(
      own.structuredContent.items.map((c: { id: string }) => c.id),
    ).toContain(a.contract.id);
    expect(own.structuredContent.items[0].end_date_mx).toMatch(
      /^\d{2}\/\d{2}\/\d{4}$/,
    );
    expect(JSON.stringify(own)).not.toContain("Contrato de Persona A");
  });

  it("mcp:list_expiring_contracts", async () => {
    expectNoLeak(
      await call(tokens.bAll, "list_expiring_contracts", {
        within_days: 365,
        limit: 100,
      }),
    );

    const today = isoToday();
    const own = await call(tokens.aRead, "list_expiring_contracts", {
      within_days: 30,
    });
    const item = own.structuredContent.items.find(
      (i: { contract_id: string }) => i.contract_id === a.contract.id,
    );
    expect(own.structuredContent.as_of).toBe(today);
    // Days from "today" in Mexico to the fixture's end date (the fixture uses UTC).
    const daysLeft = Math.round(
      (Date.parse(`${a.contract.endDate}T00:00:00Z`) -
        Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    );
    expect(item).toMatchObject({
      days_left: daysLeft,
      in_renewal_tray: true,
      sucursal: a.site.name,
    });

    // Same set as the domain query for that window.
    const domain = await listExpiringContracts(a.companyId, {
      today,
      withinDays: 30,
      limit: 100,
    });
    expect(
      own.structuredContent.items.map(
        (i: { contract_id: string }) => i.contract_id,
      ),
    ).toEqual(domain.map((row) => row.id));
    expect(
      (await call(tokens.aRead, "list_expiring_contracts", { within_days: 5 }))
        .structuredContent.items,
    ).toEqual([]);
  });

  it("mcp:list_renewal_tray", async () => {
    expectNoLeak(await call(tokens.bAll, "list_renewal_tray"));

    const own = await call(tokens.aRead, "list_renewal_tray");
    const tray = await listRenewalTrayItems(a.companyId, isoToday());
    expect(own.structuredContent.count).toBe(tray.length);
    expect(
      own.structuredContent.items.map(
        (i: { person_id: string }) => i.person_id,
      ),
    ).toEqual(tray.map((item) => item.personId));
  });

  it("mcp:get_contract", async () => {
    expect(
      errorCode(
        await call(tokens.bAll, "get_contract", { contract_id: a.contract.id }),
      ),
    ).toBe("NOT_FOUND");

    const masked = await call(tokens.aRead, "get_contract", {
      contract_id: a.contract.id,
      include_text: true,
    });
    expect(masked.structuredContent.contract.generated_text).toContain(
      "Contrato de Persona A",
    );
    expect(masked.structuredContent.contract.generated_text).not.toContain(
      RFC_A(),
    );
    expect(masked.structuredContent.contract.pii_masked).toBe(true);

    const clear = await call(tokens.aAll, "get_contract", {
      contract_id: a.contract.id,
      include_text: true,
    });
    expect(clear.structuredContent.contract.generated_text).toContain(RFC_A());
  });

  it("mcp:list_contract_templates", async () => {
    expectNoLeak(
      await call(tokens.bAll, "list_contract_templates", {
        include_body: true,
      }),
    );
    const own = await call(tokens.aRead, "list_contract_templates");
    expect(own.structuredContent.tokens).toContain("rfc");
    expect(own.structuredContent.items[0]).toMatchObject({
      id: a.template.id,
      tokens_used: ["nombres"],
    });
  });

  it("mcp:preview_contract", async () => {
    const args = {
      person_id: a.person.id,
      template_id: a.template.id,
      type: "determinado",
      start_date: "2026-12-01",
      end_date: "2027-02-28",
    };

    expect(errorCode(await call(tokens.bAll, "preview_contract", args))).toBe(
      "NOT_FOUND",
    );
    expect(
      errorCode(
        await call(tokens.bAll, "preview_contract", {
          ...args,
          template_id: b.template.id,
        }),
      ),
    ).toBe("NOT_FOUND");

    const own = await call(tokens.aRead, "preview_contract", args);
    expect(own.structuredContent.generated_text).toBe("Contrato de Persona A");
    expect(own.structuredContent.missing_tokens).toEqual([]);
    expect(own.structuredContent.blocking).toContain(
      "Esta persona ya tiene un contrato vigente.",
    );
    expect(own.structuredContent.schedule_snapshot.entrada).toBe("09:00");

    // Nothing was saved.
    const count = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.companyId, a.companyId));
    expect(count).toHaveLength(1);
  });
});

describe("assets", () => {
  it("mcp:list_assets", async () => {
    expectNoLeak(await call(tokens.bAll, "list_assets", { limit: 100 }));

    const own = await call(tokens.aRead, "list_assets", {
      query: a.asset.identifier,
    });
    expect(own.structuredContent.items).toHaveLength(1);
    expect(own.structuredContent.items[0]).toMatchObject({
      id: a.asset.id,
      holder: { id: a.person.id },
      since: "2026-01-02",
      since_mx: "02/01/2026",
    });

    const byCategory = await call(tokens.aRead, "list_assets", {
      category: "moto",
    });
    expect(
      byCategory.structuredContent.items.map((x: { id: string }) => x.id),
    ).toEqual([a.freeAsset.id]);
  });

  it("mcp:get_asset", async () => {
    expect(
      errorCode(await call(tokens.bAll, "get_asset", { asset_id: a.asset.id })),
    ).toBe("NOT_FOUND");

    const own = await call(tokens.aRead, "get_asset", { asset_id: a.asset.id });
    expect(own.structuredContent.movements[0]).toMatchObject({
      type: "entrega",
      type_label: expect.any(String),
    });
  });
});

describe("audit", () => {
  it("mcp:list_audit_events", async () => {
    expectNoLeak(await call(tokens.bAll, "list_audit_events", { limit: 100 }));

    const masked = await call(tokens.aAudit, "list_audit_events", {
      resource_id: a.person.id,
    });
    expect(masked.structuredContent.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(masked)).not.toContain(RFC_A());
    expect(JSON.stringify(masked)).not.toContain(a.person.nss!);
    expect(masked.structuredContent.pii_masked).toBe(true);

    const clear = await call(tokens.aAll, "list_audit_events", {
      resource_id: a.person.id,
    });
    expect(JSON.stringify(clear)).toContain(RFC_A());
  });

  it("needs the audit scope and audit:read", async () => {
    expect(errorCode(await call(tokens.aRead, "list_audit_events"))).toBe(
      "FORBIDDEN_SCOPE",
    );
    // A viewer has no audit:read, whatever the scopes say.
    expect(
      errorCode(await call(tokens.aViewerAudit, "list_audit_events")),
    ).toBe("FORBIDDEN_RBAC");
  });

  it("filters by source and pages by cursor", async () => {
    const mcpOnly = await call(tokens.aAudit, "list_audit_events", {
      source: "mcp",
    });
    expect(mcpOnly.structuredContent.items).toEqual([]);

    const first = await call(tokens.aAudit, "list_audit_events", { limit: 1 });
    const second = await call(tokens.aAudit, "list_audit_events", {
      limit: 1,
      cursor: first.structuredContent.next_cursor,
    });
    expect(second.structuredContent.items[0].id).not.toBe(
      first.structuredContent.items[0].id,
    );
  });
});

describe("new read-only domain queries stay inside the company", () => {
  it("lib:people/listPeopleKeyset", async () => {
    expectNoLeak(
      await listPeopleKeyset(b.companyId, { limit: 100, visibility: "todos" }),
    );
  });

  it("lib:contracts/listContractsKeyset", async () => {
    expectNoLeak(
      await listContractsKeyset(b.companyId, {
        personId: a.person.id,
        limit: 100,
      }),
    );
  });

  it("lib:contracts/listExpiringContracts", async () => {
    expectNoLeak(
      await listExpiringContracts(b.companyId, {
        today: isoToday(),
        withinDays: 365,
        limit: 100,
      }),
    );
  });

  it("lib:contracts/previewContract", async () => {
    expect(
      await previewContract(b.companyId, {
        personId: a.person.id,
        templateId: a.template.id,
        type: "indeterminado",
        startDate: "2026-12-01",
      }),
    ).toBeNull();
  });

  it("lib:resguardo/listAssetsKeyset", async () => {
    expectNoLeak(
      await listAssetsKeyset(b.companyId, {
        holderId: a.person.id,
        limit: 100,
      }),
    );
  });

  it("lib:audit/listAuditEventsKeyset", async () => {
    expectNoLeak(
      await listAuditEventsKeyset(b.companyId, {
        resourceId: a.person.id,
        limit: 100,
      }),
    );
  });
});

describe("PII sweep and output contracts", () => {
  /** Arguments that make every read tool touch the test person. */
  const sweepArgs = () => ({
    whoami: {},
    search: { query: "Persona A" },
    fetch: { id: `person:${a.person.id}` },
    list_people: { limit: 100, visibility: "todos" },
    get_person: {
      person_id: a.person.id,
      include: ["horario", "contratos", "activos", "actividades"],
    },
    list_areas: {},
    list_positions: {},
    list_activities: {},
    list_sites: {},
    list_regions: {},
    list_termination_reasons: {},
    get_seniority_certificate: { person_id: a.person.id },
    get_vacation_entitlement: { person_id: a.person.id },
    list_contracts: { person_id: a.person.id },
    list_expiring_contracts: { within_days: 365 },
    list_renewal_tray: {},
    get_contract: { contract_id: a.contract.id, include_text: true },
    list_contract_templates: { include_body: true },
    preview_contract: {
      person_id: a.person.id,
      template_id: a.template.id,
      type: "indeterminado",
      start_date: "2026-12-01",
    },
    list_assets: { holder_id: a.person.id },
    get_asset: { asset_id: a.asset.id },
    list_audit_events: { limit: 100 },
    get_onboarding: { person_id: a.person.id },
  });

  it("never returns a full RFC, CURP or NSS without the pii scope, in any read tool", async () => {
    const { WORKIA_TOOLS } = await import("@/lib/mcp/tools");
    const args = sweepArgs() as Record<string, Record<string, unknown>>;
    // An alta with Infonavit data, so get_onboarding has something to hide.
    await ownerDb
      .insert(onboardings)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        infonavitCredito: "INFONAVIT-SECRETO",
        infonavitTipoDescuento: "porcentaje",
        infonavitFactor: "20",
      })
      .onConflictDoNothing();

    expect(Object.keys(args).sort()).toEqual(
      WORKIA_TOOLS.filter((tool) => tool.kind === "read")
        .map((tool) => tool.name)
        .sort(),
    );

    for (const tool of WORKIA_TOOLS.filter(
      (candidate) => candidate.kind === "read",
    )) {
      const result = await call(tokens.aAudit, tool.name, args[tool.name]);
      const body = JSON.stringify(result);

      expect(result.isError, tool.name).toBeFalsy();
      for (const secret of [
        RFC_A(),
        CURP_A(),
        a.person.nss!,
        "Calle Secreta 77",
        "SECRETOINE00000001",
        "Beneficiaria Secreta",
        "INFONAVIT-SECRETO",
      ]) {
        expect(body, `${tool.name} leaked PII`).not.toContain(secret);
      }
      // Each structuredContent satisfies the advertised output schema.
      expect(
        tool.output.safeParse(result.structuredContent).success,
        tool.name,
      ).toBe(true);
    }
  });
});

describe("expediente México in the connector (WRK-I1-9)", () => {
  it("shows only what is captured without pii, and the data with pii", async () => {
    const masked = await call(tokens.aRead, "get_person", {
      person_id: a.person.id,
    });
    expect(masked.structuredContent.datos_mexico).toEqual({
      pii_masked: true,
      capturado: {
        domicilio: true,
        estado_civil: true,
        sexo: false,
        lugar_nacimiento: false,
        nacionalidad: false,
        ine: true,
        beneficiarios: 1,
      },
    });

    const clear = await call(tokens.aAll, "get_person", {
      person_id: a.person.id,
    });
    expect(clear.structuredContent.datos_mexico).toMatchObject({
      pii_masked: false,
      domicilio: {
        calle: "Calle Secreta 77",
        codigo_postal: "29000",
        estado: "Chiapas",
      },
      estado_civil: "casado",
      ine_clave_elector: "SECRETOINE00000001",
      beneficiarios: [
        {
          nombre: "Beneficiaria Secreta",
          parentesco: "Madre",
          porcentaje: 100,
        },
      ],
    });

    const fetched = await call(tokens.aAll, "fetch", {
      id: `person:${a.person.id}`,
    });
    expect(fetched.structuredContent.text).toContain("Calle Secreta 77");
  });
});

// Runs last: it adds templates and a contract to company A.
describe("official tokens and seniority certificate (WRK-I1-12)", () => {
  it("mcp:get_seniority_certificate", async () => {
    const other = await call(tokens.bAll, "get_seniority_certificate", {
      person_id: a.person.id,
    });
    expect(errorCode(other)).toBe("NOT_FOUND");

    const masked = await call(tokens.aRead, "get_seniority_certificate", {
      person_id: a.person.id,
    });
    expect(masked.structuredContent).toMatchObject({
      person: { id: a.person.id },
      pii_masked: true,
      contratos: [{ id: a.contract.id }],
    });
    expect(masked.structuredContent.text).toContain("CONSTANCIA DE ANTIGÜEDAD");
    expect(masked.structuredContent.text).not.toContain(CURP_A());

    const full = await call(tokens.aAll, "get_seniority_certificate", {
      person_id: a.person.id,
    });
    expect(full.structuredContent.text).toContain(CURP_A());
  });

  it("preview_contract fills the salary tokens only for who may see them", async () => {
    const template = await createContractTemplate(
      a.companyId,
      {
        name: "Con salario",
        body: "Salario {{salario_diario}} ({{salario_mensual}}), {{periodicidad}}. CURP {{curp}}. Ingreso {{fecha_ingreso}}.",
        active: true,
      },
      a.admin.id,
    );
    const args = {
      person_id: a.person.id,
      template_id: template.id,
      type: "indeterminado",
      start_date: "2027-01-01",
      compensacion: {
        salario_diario: 500,
        forma_pago: "transferencia",
        periodicidad: "quincenal",
      },
    };

    const full = await call(tokens.aAll, "preview_contract", args);
    expect(full.structuredContent.generated_text).toContain(
      "Salario $500.00 ($15,200.00), quincenal.",
    );
    expect(full.structuredContent.missing_tokens).not.toContain(
      "salario_diario",
    );

    const noPii = await call(tokens.aRead, "preview_contract", args);
    expect(errorCode(noPii)).toBe("FORBIDDEN_SCOPE");

    const withoutSalary = await call(tokens.aRead, "preview_contract", {
      ...args,
      compensacion: undefined,
    });
    expect(withoutSalary.structuredContent.missing_tokens).toEqual(
      expect.arrayContaining(["salario_diario", "salario_mensual"]),
    );
    expect(withoutSalary.structuredContent.generated_text).not.toContain(
      CURP_A(),
    );
  });

  it("get_contract hides the salary in the text without compensation access", async () => {
    const template = await createContractTemplate(
      a.companyId,
      {
        name: "Texto con salario",
        body: "Salario {{salario_diario}}.",
        active: true,
      },
      a.admin.id,
    );
    const [person] = await ownerDb
      .insert(people)
      .values({
        companyId: a.companyId,
        nombres: "Sin",
        apellidoPaterno: "Contrato",
        status: "activa",
      })
      .returning();
    const contract = await createContract(
      a.companyId,
      {
        personId: person.id,
        templateId: template.id,
        type: "indeterminado",
        startDate: "2027-02-01",
        endDate: "",
        noticeWindow: "no_avisar",
        salarioDiario: 650,
        formaPago: "efectivo",
        periodicidadPago: "semanal",
      },
      a.admin.id,
    );

    const masked = await call(tokens.aRead, "get_contract", {
      contract_id: contract.id,
      include_text: true,
    });
    expect(masked.structuredContent.contract.generated_text).toBe(
      "Salario [salario oculto].",
    );
    const full = await call(tokens.aAll, "get_contract", {
      contract_id: contract.id,
      include_text: true,
    });
    expect(full.structuredContent.contract.generated_text).toBe(
      "Salario $650.00.",
    );
  });
});

describe("vacation entitlement (WRK-I14-2)", () => {
  it("mcp:get_vacation_entitlement", async () => {
    const today = isoToday();
    const [person] = await ownerDb
      .insert(people)
      .values({
        companyId: a.companyId,
        nombres: "Persona",
        apellidoPaterno: "Vacaciones",
        fechaIngreso: "2023-03-01",
        status: "activa",
      })
      .returning();
    await ownerDb.insert(employmentPeriods).values({
      companyId: a.companyId,
      personId: person.id,
      fechaIngreso: "2023-03-01",
      fechaAntiguedad: "2023-03-01",
    });

    const foreign = await call(tokens.bAll, "get_vacation_entitlement", {
      person_id: person.id,
    });
    expect(errorCode(foreign)).toBe("NOT_FOUND");
    expectNoLeak(foreign);

    const own = await call(tokens.aRead, "get_vacation_entitlement", {
      person_id: person.id,
    });
    const entitled = vacationEntitlementForPerson({
      seniorityDate: "2023-03-01",
      status: "activa",
      fechaBaja: null,
      today,
    });

    expect(own.isError).toBeFalsy();
    expect(own.structuredContent).toEqual({
      ...vacationToolFields(entitled),
      url: `${ORIGIN}/app/personas/${person.id}`,
    });
    expect(own.structuredContent.prima_vacacional).toBe(
      "Prima vacacional: no menor al 25% (Art. 80 LFT)",
    );
    expect(own.structuredContent).not.toHaveProperty("notes");
    expect(JSON.stringify(own.structuredContent)).not.toMatch(
      /tomados|saldo|pendiente de confirmación/i,
    );

    const [closedPerson] = await ownerDb
      .insert(people)
      .values({
        companyId: a.companyId,
        nombres: "Persona",
        apellidoPaterno: "Cerrada",
        fechaIngreso: "2020-03-01",
        status: "baja",
      })
      .returning();
    await ownerDb.insert(employmentPeriods).values({
      companyId: a.companyId,
      personId: closedPerson.id,
      fechaIngreso: "2020-03-01",
      fechaAntiguedad: "2020-03-01",
      fechaBaja: "2022-06-01",
      bajaSinFecha: false,
    });

    const closed = await call(tokens.aRead, "get_vacation_entitlement", {
      person_id: closedPerson.id,
    });
    const closedView = vacationEntitlementForPerson({
      seniorityDate: "2020-03-01",
      status: "baja",
      fechaBaja: "2022-06-01",
      today,
    });

    expect(closed.structuredContent).toEqual({
      ...vacationToolFields(closedView),
      url: `${ORIGIN}/app/personas/${closedPerson.id}`,
    });
    expect(closed.structuredContent.state).toBe("before_table");
    expect(closed.structuredContent.grant_by).toBeNull();
    expect(closed.structuredContent.closed).toBe(true);

    const missing = await call(tokens.aRead, "get_vacation_entitlement", {
      person_id: a.person.id,
    });
    expect(missing.structuredContent.state).toBe("no_hire_date");
    expect(missing.structuredContent.message).toBe("Sin fecha de ingreso");
  });
});
