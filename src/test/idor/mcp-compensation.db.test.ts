/**
 * Contract compensation through the connector (WRK-I1-10): captured on
 * issue/renew and shown by get_contract and fetch only with the pii scope and
 * compensation:read; otherwise only whether it is captured.
 */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as mcpPost } from "@/app/api/mcp/route";
import { contracts, mcpConnections } from "@/lib/db/schema";
import type { McpScope } from "@/lib/mcp/scopes";
import { setMcpWritesEnabled } from "@/lib/mcp/settings";
import { generateToken } from "@/lib/mcp/tokens";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

const ALL: McpScope[] = ["read", "pii", "write:contracts"];

let t: Tenant;
const tokens: Record<string, string> = {};
let keySeq = 0;

const tokenFor = async (userId: string, scopes: McpScope[]) => {
  const token = generateToken("pat");
  await ownerDb.insert(mcpConnections).values({
    companyId: t.companyId,
    userId,
    kind: "pat",
    name: `comp ${scopes.join(",")}`,
    clientName: "Claude",
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
    new Request("http://localhost:3000/api/mcp", {
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

const confirm = async (
  bearer: string,
  name: string,
  args: Record<string, unknown>,
) => {
  const withKey = { ...args, idempotency_key: `key-compensation-${++keySeq}` };
  const preview = await call(bearer, name, withKey);
  if (preview.isError) return { preview, done: preview };
  const done = await call(bearer, name, {
    ...withKey,
    confirmation_token: preview.structuredContent.confirmation_token,
  });
  return { preview, done };
};

const compensacion = {
  salario_diario: 500,
  forma_pago: "transferencia",
  periodicidad: "quincenal",
  dia_pago: "15 y último",
};

const terms = () => ({
  type: "indeterminado",
  start_date: "2026-12-01",
  notice_window: "no_avisar",
  template_id: t.template.id,
});

let issuedId: string;

beforeAll(async () => {
  t = await seedTenant("MCPCOMP");
  await setMcpWritesEnabled(t.companyId, true, t.admin.id);
});

beforeEach(async () => {
  tokens.admin = await tokenFor(t.admin.id, ALL);
  tokens.adminNoPii = await tokenFor(t.admin.id, ["read", "write:contracts"]);
  tokens.editor = await tokenFor(t.editor.id, ALL);
});

describe("compensation through the connector", () => {
  it("issue_contract refuses compensation without pii or compensation:read", async () => {
    const noPii = await confirm(tokens.adminNoPii, "issue_contract", {
      person_id: t.teammate.id,
      ...terms(),
      compensacion,
    });
    expect(code(noPii.done)).toBe("FORBIDDEN_SCOPE");

    const editor = await confirm(tokens.editor, "issue_contract", {
      person_id: t.teammate.id,
      ...terms(),
      compensacion,
    });
    expect(code(editor.done)).toBe("FORBIDDEN_RBAC");
  });

  it("issue_contract freezes the compensation with the monthly salary", async () => {
    const { preview, done } = await confirm(tokens.admin, "issue_contract", {
      person_id: t.teammate.id,
      ...terms(),
      compensacion,
    });

    expect(preview.structuredContent.preview.summary).toContain(
      "Salario diario $500.00",
    );
    expect(done.structuredContent.status).toBe("done");
    issuedId = done.structuredContent.contract.id;
    const [row] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, issuedId));
    expect(row).toMatchObject({
      salarioDiario: "500.00",
      salarioMensual: "15200.00",
      formaPago: "transferencia",
      periodicidadPago: "quincenal",
      diaPago: "15 y último",
    });
  });

  it("get_contract shows the amounts only with pii and compensation:read", async () => {
    const full = await call(tokens.admin, "get_contract", {
      contract_id: issuedId,
    });
    expect(full.structuredContent.contract.compensacion).toEqual({
      capturada: true,
      salario_diario: 500,
      salario_mensual: 15200,
      forma_pago: "transferencia",
      periodicidad: "quincenal",
      dia_pago: "15 y último",
    });

    for (const bearer of [tokens.adminNoPii, tokens.editor]) {
      const masked = await call(bearer, "get_contract", {
        contract_id: issuedId,
      });
      expect(masked.structuredContent.contract.compensacion).toEqual({
        capturada: true,
      });
    }
  });

  it("fetch adds the compensation line only when it may be seen", async () => {
    const full = await call(tokens.admin, "fetch", {
      id: `contract:${issuedId}`,
    });
    expect(full.structuredContent.text).toContain("Mensual $15,200.00");

    const masked = await call(tokens.editor, "fetch", {
      id: `contract:${issuedId}`,
    });
    expect(masked.structuredContent.text).not.toContain("Compensación");
    expect(JSON.stringify(masked)).not.toContain("15,200");
  });

  it("renew_contract without compensation keeps the previous one", async () => {
    const { preview, done } = await confirm(tokens.editor, "renew_contract", {
      contract_id: issuedId,
      ...terms(),
      start_date: "2027-12-01",
    });

    expect(preview.structuredContent.preview.summary).toContain(
      "Conserva la compensación",
    );
    const [row] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, done.structuredContent.contract.id));
    expect(row.salarioDiario).toBe("500.00");
    expect(row.previousContractId).toBe(issuedId);
    issuedId = row.id;
  });

  it("renew_contract with new compensation freezes the new amounts", async () => {
    const { done } = await confirm(tokens.admin, "renew_contract", {
      contract_id: issuedId,
      ...terms(),
      start_date: "2028-12-01",
      compensacion: {
        salario_diario: 600,
        forma_pago: "efectivo",
        periodicidad: "semanal",
      },
    });
    const [row] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, done.structuredContent.contract.id));
    expect(row).toMatchObject({
      salarioDiario: "600.00",
      salarioMensual: "18240.00",
      formaPago: "efectivo",
      diaPago: null,
    });
  });
});
