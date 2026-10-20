/**
 * The renewal decision in one step (WRK-I5-6): the three decisions, the
 * position change in the same transaction, the reason column, and that the
 * hire date never changes. Test titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { decideContractRenewal } from "@/lib/contracts";
import { decideContractRenewalAction } from "@/lib/contracts/actions";
import { contracts, people, positions } from "@/lib/db/schema";

import { ownerDb, seedTenant, snapshotTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    return await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
};

const vigenteOf = async (personId: string) =>
  (
    await ownerDb
      .select()
      .from(contracts)
      .where(
        and(eq(contracts.personId, personId), eq(contracts.status, "vigente")),
      )
  )[0];

const personRow = async (id: string) =>
  (await ownerDb.select().from(people).where(eq(people.id, id)))[0];

beforeAll(async () => {
  a = await seedTenant("DA");
  b = await seedTenant("DB");
  await ownerDb
    .update(people)
    .set({ fechaIngreso: "2022-05-02" })
    .where(eq(people.id, a.person.id));
});

describe("renewal decision isolation", () => {
  it("lib:contracts/decideContractRenewal", async () => {
    const before = await snapshotTenant(a);
    await expect(
      decideContractRenewal(
        b.companyId,
        {
          contractId: a.contract.id,
          decision: "no_renovar",
          motivo: "intruso",
        },
        b.admin.id,
      ),
    ).rejects.toMatchObject({ name: "ContractNotVigenteError" });
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:contracts/decideContractRenewalAction", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const result = await redirectOf(() =>
      decideContractRenewalAction(
        {},
        formData({
          contractId: a.contract.id,
          decision: "no_renovar",
          motivo: "intruso",
          companyId: b.companyId,
        }),
      ),
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/vigente/) });
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("rbac:action:contracts/decideContractRenewalAction", async () => {
    actAs(a.viewer);
    const before = await snapshotTenant(a);
    const result = await redirectOf(() =>
      decideContractRenewalAction(
        {},
        formData({
          contractId: a.contract.id,
          decision: "no_renovar",
          motivo: "x",
          companyId: a.companyId,
        }),
      ),
    );
    expect(result).toEqual({
      error: "No tienes permiso para decidir renovaciones.",
    });
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("the three decisions", () => {
  it("no renewing needs a reason, which is stored in its column", async () => {
    actAs(a.admin);
    const missing = await redirectOf(() =>
      decideContractRenewalAction(
        {},
        formData({
          contractId: a.contract.id,
          decision: "no_renovar",
          companyId: a.companyId,
        }),
      ),
    );
    expect(missing).toEqual({ error: "Indica el motivo para no renovar." });

    // A position of company B cannot be used either.
    await expect(
      decideContractRenewal(
        a.companyId,
        {
          contractId: a.contract.id,
          decision: "renovar_indeterminado",
          templateId: a.template.id,
          newPositionId: b.position.id,
        },
        a.admin.id,
      ),
    ).rejects.toThrow(/puesto/);
    expect((await vigenteOf(a.person.id)).id).toBe(a.contract.id);
  });

  it("renewing fixed-term with a new position changes it in the same step and keeps the hire date", async () => {
    const [newPosition] = await ownerDb
      .insert(positions)
      .values({
        companyId: a.companyId,
        name: "Supervisor DA",
        areaId: a.area.id,
      })
      .returning();
    const result = await decideContractRenewal(
      a.companyId,
      {
        contractId: a.contract.id,
        decision: "renovar_determinado",
        templateId: a.template.id,
        startDate: "2027-01-01",
        endDate: "2027-06-30",
        newPositionId: newPosition.id,
      },
      a.admin.id,
    );

    expect(result.contract).toMatchObject({
      type: "determinado",
      endDate: "2027-06-30",
      previousContractId: a.contract.id,
    });
    expect(result.constanciaAvailable).toBe(false);
    const person = await personRow(a.person.id);
    expect(person.positionId).toBe(newPosition.id);
    expect(person.fechaIngreso).toBe("2022-05-02");
    const [previous] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, a.contract.id));
    expect(previous.status).toBe("renovado");
  });

  it("renewing open-ended offers the seniority certificate", async () => {
    const current = await vigenteOf(a.person.id);
    const result = await decideContractRenewal(
      a.companyId,
      {
        contractId: current.id,
        decision: "renovar_indeterminado",
        templateId: a.template.id,
      },
      a.admin.id,
    );

    expect(result.contract).toMatchObject({
      type: "indeterminado",
      endDate: null,
      noticeWindow: "no_avisar",
      // Starts when the previous one ended.
      startDate: current.endDate,
    });
    expect(result.constanciaAvailable).toBe(true);
    expect((await personRow(a.person.id)).fechaIngreso).toBe("2022-05-02");
  });

  it("not renewing marks it and keeps the reason", async () => {
    const current = await vigenteOf(a.person.id);
    actAs(a.admin);
    const url = await redirectOf(() =>
      decideContractRenewalAction(
        {},
        formData({
          contractId: current.id,
          decision: "no_renovar",
          motivo: "Fin del proyecto",
          companyId: a.companyId,
        }),
      ),
    );
    expect(url).toBe("/app/contratos?no-renew=1");
    const [row] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.id, current.id));
    expect(row).toMatchObject({
      status: "no_renovado",
      noRenewReason: "Fin del proyecto",
    });
    expect((await personRow(a.person.id)).fechaIngreso).toBe("2022-05-02");
  });
});
