/**
 * Cross-company isolation for contracts and templates (WRK-I4-8). Test titles
 * are the surface ids of docs/idor-matrix.md.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  countRenewalTrayItems,
  createContract,
  createContractTemplate,
  deactivateContractTemplate,
  getContractById,
  getContractTemplateById,
  getVigenteContractForPerson,
  listActiveContractTemplates,
  listContractTemplates,
  listContractsByPerson,
  listRenewalTrayItems,
  markContractNoRenew,
  renewContract,
  softDeleteContract,
  softDeleteContractTemplate,
  updateContractTemplate,
} from "@/lib/contracts";
import {
  createContractAction,
  createContractTemplateAction,
  deactivateContractTemplateAction,
  deleteContractTemplateAction,
  noRenewContractAction,
  renewContractAction,
  updateContractTemplateAction,
} from "@/lib/contracts/actions";

import {
  idsIn,
  seedTenant,
  snapshotTenant,
  tenantIds,
  type Tenant,
} from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;

const noLeak = (value: unknown) => {
  const leaked = idsIn(value).filter((id) => tenantIds(a).has(id));
  expect(leaked, "ids of company A in company B's result").toEqual([]);
};

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  return "no redirect";
};

const contractInput = (personId: string, templateId: string) => ({
  personId,
  templateId,
  type: "indeterminado" as const,
  startDate: "2026-09-01",
  endDate: "",
  noticeWindow: "no_avisar" as const,
});

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("contract reads stay inside the company", () => {
  it.each([
    [
      "lib:contracts/listActiveContractTemplates",
      () => listActiveContractTemplates(b.companyId),
    ],
    [
      "lib:contracts/listContractTemplates",
      () => listContractTemplates(b.companyId, true),
    ],
    [
      "lib:contracts/listContractsByPerson",
      () => listContractsByPerson(b.companyId, a.person.id),
    ],
    [
      "lib:contracts/listRenewalTrayItems",
      () => listRenewalTrayItems(b.companyId),
    ],
  ])("%s", async (_surface, read) => {
    noLeak(await read());
  });

  it.each([
    [
      "lib:contracts/getContractTemplateById",
      () => getContractTemplateById(b.companyId, a.template.id),
    ],
    [
      "lib:contracts/getContractById",
      () => getContractById(b.companyId, a.contract.id),
    ],
    [
      "lib:contracts/getVigenteContractForPerson",
      () => getVigenteContractForPerson(b.companyId, a.person.id),
    ],
  ])("%s", async (_surface, read) => {
    expect(await read()).toBeNull();
  });

  it("lib:contracts/countRenewalTrayItems", async () => {
    // Each company counts its own contract about to end, never the other's.
    expect(await countRenewalTrayItems(b.companyId)).toBe(1);
    expect(await countRenewalTrayItems(a.companyId)).toBe(1);
  });
});

describe("contract writes cannot reach another company", () => {
  it("lib:contracts/createContract", async () => {
    await expect(
      createContract(
        b.companyId,
        contractInput(b.teammate.id, a.template.id),
        b.admin.id,
      ),
    ).rejects.toThrow("Plantilla no encontrada.");
    await expect(
      createContract(
        b.companyId,
        contractInput(a.teammate.id, b.template.id),
        b.admin.id,
      ),
    ).rejects.toThrow("Persona no encontrada.");
  });

  it("lib:contracts/createContractTemplate", async () => {
    const created = await createContractTemplate(
      b.companyId,
      { name: a.template.name, body: "Texto", active: true },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it.each([
    [
      "lib:contracts/renewContract",
      () =>
        renewContract(
          b.companyId,
          {
            ...contractInput(a.person.id, b.template.id),
            contractId: a.contract.id,
          },
          b.admin.id,
        ),
    ],
    [
      "lib:contracts/markContractNoRenew",
      () => markContractNoRenew(b.companyId, a.contract.id, b.admin.id),
    ],
    [
      "lib:contracts/softDeleteContract",
      () => softDeleteContract(b.companyId, a.contract.id, b.admin.id),
    ],
    [
      "lib:contracts/updateContractTemplate",
      () =>
        updateContractTemplate(
          b.companyId,
          a.template.id,
          { name: "x", body: "x", active: true },
          b.admin.id,
        ),
    ],
    [
      "lib:contracts/deactivateContractTemplate",
      () => deactivateContractTemplate(b.companyId, a.template.id, b.admin.id),
    ],
    [
      "lib:contracts/softDeleteContractTemplate",
      () => softDeleteContractTemplate(b.companyId, a.template.id, b.admin.id),
    ],
  ])("%s", async (_surface, write) => {
    const before = await snapshotTenant(a);
    await expect(write()).rejects.toThrow(/no encontrad/);
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("contract actions with company B's session", () => {
  it("action:contracts/createContractAction", async () => {
    actAs(b.admin);
    const result = await createContractAction(
      {},
      formData({
        ...contractInput(b.teammate.id, a.template.id),
        companyId: b.companyId,
      }),
    );
    expect(result.error).toBe("Plantilla no encontrada.");
  });

  it("action:contracts/renewContractAction", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const result = await renewContractAction(
      {},
      formData({
        ...contractInput(a.person.id, b.template.id),
        contractId: a.contract.id,
        companyId: b.companyId,
      }),
    );
    expect(result.error).toMatch(/no encontrado/);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it.each([
    [
      "action:contracts/noRenewContractAction",
      () => noRenewContractAction(a.contract.id),
      "/app/contratos?error=not-found",
    ],
    [
      "action:contracts/deactivateContractTemplateAction",
      () => deactivateContractTemplateAction(a.template.id),
      "/app/contratos/plantillas?error=not-found",
    ],
    [
      "action:contracts/deleteContractTemplateAction",
      () => deleteContractTemplateAction(a.template.id),
      "/app/contratos/plantillas?error=not-found",
    ],
    [
      "action:contracts/updateContractTemplateAction",
      () =>
        updateContractTemplateAction(
          a.template.id,
          formData({
            name: "Robada",
            body: "x",
            active: "on",
            companyId: b.companyId,
          }),
        ),
      "/app/contratos/plantillas?error=not-found",
    ],
  ])("%s", async (_surface, run, expected) => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    expect(await redirectOf(run)).toBe(expected);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:contracts/createContractTemplateAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        createContractTemplateAction(
          formData({
            name: "Otra",
            body: "x",
            active: "on",
            companyId: a.companyId,
          }),
        ),
      ),
    ).toBe("/app/contratos/plantillas?error=company-changed");
  });
});

describe("contract permissions", () => {
  it("rbac:action:contracts/createContractAction", async () => {
    actAs(b.viewer);
    expect(
      (
        await createContractAction(
          {},
          formData(contractInput(b.teammate.id, b.template.id)),
        )
      ).error,
    ).toMatch(/permiso/);
  });

  it("rbac:action:contracts/renewContractAction", async () => {
    actAs(b.viewer);
    expect(
      (await renewContractAction({}, formData({ contractId: b.contract.id })))
        .error,
    ).toMatch(/permiso/);
  });

  it.each([
    [
      "rbac:action:contracts/noRenewContractAction",
      () => noRenewContractAction(b.contract.id),
    ],
    [
      "rbac:action:contracts/createContractTemplateAction",
      () => createContractTemplateAction(formData({ name: "x", body: "x" })),
    ],
    [
      "rbac:action:contracts/updateContractTemplateAction",
      () =>
        updateContractTemplateAction(
          b.template.id,
          formData({ name: "x", body: "x" }),
        ),
    ],
    [
      "rbac:action:contracts/deactivateContractTemplateAction",
      () => deactivateContractTemplateAction(b.template.id),
    ],
    [
      "rbac:action:contracts/deleteContractTemplateAction",
      () => deleteContractTemplateAction(b.template.id),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.viewer);
    const before = await snapshotTenant(b);
    expect(await redirectOf(run)).toMatch(/permission/);
    expect(await snapshotTenant(b)).toEqual(before);
  });
});
