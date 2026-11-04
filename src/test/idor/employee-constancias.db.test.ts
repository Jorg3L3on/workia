/**
 * Constancias, contract and resguardo in the employee app (Workia 2.0 W2-11)
 * on a real database. The employee session is the only source of the person:
 * a contract id of a teammate or of another company is a 404, and an entrega
 * of someone else cannot be accepted. Each download writes one access log
 * row (W2-09) and one audit event with the employee account as the actor.
 * Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  current: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...original,
    getEmployeeContext: async () => session.current,
    requireEmployeeContext: async () => {
      if (!session.current) throw new NavigationThrow("redirect", "/mi/entrar");
      return session.current;
    },
  };
});

import { GET as seniorityRoute } from "@/app/mi/constancia/pdf/route";
import { GET as contractRoute } from "@/app/mi/contrato/[contractId]/pdf/route";
import {
  assetMovements,
  assets,
  auditEvents,
  contracts,
  employeeAccounts,
  personalDataAccessLog,
} from "@/lib/db/schema";
import { listEmployeeContracts } from "@/lib/employee/constancias";
import {
  listEmployeeResguardo,
  RESGUARDO_COPY,
} from "@/lib/employee/resguardo";
import { acceptResguardoAction } from "@/lib/employee/resguardo-actions";
import { extractPdfText } from "@/test/pdf-text";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

let a: Tenant;
const asset0 = () => Math.random().toString(36).slice(2, 10);
let b: Tenant;
const accounts = {} as Record<"a" | "aTeammate" | "b", string>;

const contextOf = (key: keyof typeof accounts) => {
  const tenant = key === "b" ? b : a;
  return {
    accountId: accounts[key],
    companyId: tenant.companyId,
    personId: key === "aTeammate" ? a.teammate.id : tenant.person.id,
    sessionId: "test",
  };
};

const signInAs = (key: keyof typeof accounts | null) => {
  session.current = key ? contextOf(key) : null;
};

const callContract = (contractId: string) =>
  contractRoute(new Request(`http://test/mi/contrato/${contractId}/pdf`), {
    params: Promise.resolve({ contractId }),
  });

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const readsOf = (companyId: string, resource: string) =>
  ownerDb
    .select()
    .from(personalDataAccessLog)
    .where(
      and(
        eq(personalDataAccessLog.companyId, companyId),
        eq(personalDataAccessLog.resource, resource as "contract_pdf"),
      ),
    );

const account = async (tenant: Tenant, personId: string) => {
  const [row] = await ownerDb
    .insert(employeeAccounts)
    .values({
      companyId: tenant.companyId,
      personId,
      status: "active",
      email: `${personId.slice(0, 8)}@empleo.test`,
      emailVerifiedAt: new Date(),
      activatedAt: new Date(),
    })
    .returning();
  return row.id;
};

beforeAll(async () => {
  a = await seedTenant("CNA");
  b = await seedTenant("CNB");
  accounts.a = await account(a, a.person.id);
  accounts.aTeammate = await account(a, a.teammate.id);
  accounts.b = await account(b, b.person.id);
});

beforeEach(() => {
  signInAs(null);
});

describe("an employee downloads only their own contract and constancia", () => {
  it("route:GET /mi/contrato/[contractId]/pdf", async () => {
    const [teammateContract] = await ownerDb
      .insert(contracts)
      .values({
        companyId: a.companyId,
        personId: a.teammate.id,
        type: "indeterminado",
        startDate: "2025-06-01",
        noticeWindow: "no_avisar",
        templateName: "Plantilla",
        generatedText: "Contrato de la compañera",
      })
      .returning();

    // No session is a 401; the guard never reads the URL's id.
    expect((await callContract(a.contract.id)).status).toBe(401);

    // Company B's employee, and A's teammate, get a 404 for A's contract.
    signInAs("b");
    expect((await callContract(a.contract.id)).status).toBe(404);
    signInAs("aTeammate");
    expect((await callContract(a.contract.id)).status).toBe(404);
    signInAs("a");
    expect((await callContract(teammateContract.id)).status).toBe(404);
    expect((await callContract("not-a-uuid")).status).toBe(404);

    const response = await callContract(a.contract.id);
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(extractPdfText(bytes)).toContain(a.contract.generatedText);

    // One read in the access log and one audit event, both the employee's.
    expect(await readsOf(a.companyId, "contract_pdf")).toEqual([
      expect.objectContaining({
        personId: a.person.id,
        resourceId: a.contract.id,
        actorKind: "employee",
        actorUserId: null,
      }),
    ]);
    const audit = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceId, a.contract.id),
          eq(auditEvents.action, "export"),
        ),
      );
    expect(audit).toEqual([
      expect.objectContaining({
        actorEmployeeAccountId: accounts.a,
        actorUserId: null,
        resourceType: "contract",
      }),
    ]);
    expect(await readsOf(b.companyId, "contract_pdf")).toEqual([]);
  });

  it("lists only the session person's contracts", async () => {
    const own = await listEmployeeContracts(contextOf("a"));
    expect(own.map((row) => row.id)).toContain(a.contract.id);
    expect(own).not.toContainEqual(
      expect.objectContaining({ id: b.contract.id }),
    );
    expect(
      await listEmployeeContracts({
        ...contextOf("a"),
        companyId: b.companyId,
      }),
    ).toEqual([]);
    expect(
      (await listEmployeeContracts(contextOf("aTeammate"))).map((r) => r.id),
    ).not.toContain(a.contract.id);
  });

  it("route:GET /mi/constancia/pdf", async () => {
    expect((await seniorityRoute()).status).toBe(401);

    signInAs("a");
    const response = await seniorityRoute();
    const text = extractPdfText(Buffer.from(await response.arrayBuffer()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(text).toContain("CONSTANCIA DE ANTIGÜEDAD");
    expect(text).toContain(a.person.nombres);
    expect(text).not.toContain(a.teammate.nombres);
    expect(text).toContain("de quien expide");

    expect(await readsOf(a.companyId, "seniority_letter")).toEqual([
      expect.objectContaining({
        personId: a.person.id,
        actorKind: "employee",
      }),
    ]);

    // Company B's employee gets their own letter, logged in company B.
    signInAs("b");
    const other = extractPdfText(
      Buffer.from(await (await seniorityRoute()).arrayBuffer()),
    );
    expect(other).toContain(b.person.nombres);
    expect(other).not.toContain(a.person.nombres);
    expect(await readsOf(a.companyId, "seniority_letter")).toHaveLength(1);
    expect(await readsOf(b.companyId, "seniority_letter")).toHaveLength(1);
  });
});

describe("an employee accepts only their own resguardo", () => {
  it("action:employee/acceptResguardoAction", async () => {
    const [entrega] = await ownerDb
      .select()
      .from(assetMovements)
      .where(
        and(
          eq(assetMovements.companyId, a.companyId),
          eq(assetMovements.assetId, a.asset.id),
        ),
      );

    // Not signed in: sent to sign in, nothing written.
    await expect(
      acceptResguardoAction({}, formData({ movementId: entrega.id })),
    ).rejects.toThrow(/redirect/);

    // Another company's employee and a teammate cannot accept A's entrega.
    signInAs("b");
    expect(
      await acceptResguardoAction({}, formData({ movementId: entrega.id })),
    ).toEqual({ error: RESGUARDO_COPY.notFound });
    signInAs("aTeammate");
    expect(
      await acceptResguardoAction({}, formData({ movementId: entrega.id })),
    ).toEqual({ error: RESGUARDO_COPY.notFound });
    signInAs("a");
    expect(
      await acceptResguardoAction({}, formData({ movementId: "x" })),
    ).toEqual({ error: RESGUARDO_COPY.notFound });

    const [untouched] = await ownerDb
      .select()
      .from(assetMovements)
      .where(eq(assetMovements.id, entrega.id));
    expect(untouched.acceptedAt).toBeNull();

    expect(
      await acceptResguardoAction({}, formData({ movementId: entrega.id })),
    ).toEqual({ acceptedId: entrega.id });
    const [accepted] = await ownerDb
      .select()
      .from(assetMovements)
      .where(eq(assetMovements.id, entrega.id));
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.acceptedByEmployeeAccountId).toBe(accounts.a);

    // Twice keeps the first time.
    expect(
      await acceptResguardoAction({}, formData({ movementId: entrega.id })),
    ).toEqual({ error: RESGUARDO_COPY.alreadyAccepted });

    const audit = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, entrega.id),
          eq(auditEvents.action, "accept"),
        ),
      );
    expect(audit).toEqual([
      expect.objectContaining({
        companyId: a.companyId,
        actorEmployeeAccountId: accounts.a,
        resourceType: "asset_movement",
      }),
    ]);

    expect(await listEmployeeResguardo(contextOf("a"))).toEqual([
      expect.objectContaining({
        assetId: a.asset.id,
        movementId: entrega.id,
        acceptedAt: accepted.acceptedAt,
      }),
    ]);
    expect(await listEmployeeResguardo(contextOf("aTeammate"))).toEqual([]);
  });

  it("does not accept an entrega of an asset already returned", async () => {
    const [asset] = await ownerDb
      .insert(assets)
      .values({
        companyId: b.companyId,
        name: "Teléfono devuelto",
        identifier: `TEL-${asset0()}`,
        category: "telefono",
        status: "disponible",
      })
      .returning();
    const [old] = await ownerDb
      .insert(assetMovements)
      .values({
        companyId: b.companyId,
        assetId: asset.id,
        type: "entrega",
        personId: b.person.id,
        movementDate: "2026-01-05",
        conditionNote: "bueno",
      })
      .returning();

    signInAs("b");
    expect(
      await acceptResguardoAction({}, formData({ movementId: old.id })),
    ).toEqual({ error: RESGUARDO_COPY.notFound });
  });

  it("the database refuses an acceptance on a devolución", async () => {
    await expect(
      ownerDb.insert(assetMovements).values({
        companyId: a.companyId,
        assetId: a.asset.id,
        type: "devolucion",
        personId: a.person.id,
        movementDate: "2026-02-01",
        conditionNote: "ok",
        acceptedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
