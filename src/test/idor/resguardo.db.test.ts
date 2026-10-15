/**
 * Cross-company isolation for asset custody (WRK-I4-9). Test titles are the
 * surface ids of docs/idor-matrix.md.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  assignAsset,
  countAssignedAssets,
  createAsset,
  getAssetById,
  getAssetWithHolder,
  listAssetMovements,
  listAssetsByPerson,
  listAssetsPage,
  returnAsset,
  softDeleteAsset,
} from "@/lib/resguardo";
import {
  assignAssetAction,
  createAssetAction,
  deleteAssetAction,
  returnAssetAction,
} from "@/lib/resguardo/actions";

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

const movement = {
  movementDate: "2026-10-01",
  conditionNote: "Buen estado",
  notes: "",
};

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("resguardo reads stay inside the company", () => {
  it.each([
    [
      "lib:resguardo/listAssetsPage",
      () =>
        listAssetsPage(b.companyId, {
          page: 1,
          pageSize: 100,
          includeDeleted: true,
        }),
    ],
    [
      "lib:resguardo/listAssetMovements",
      () => listAssetMovements(b.companyId, a.asset.id),
    ],
    [
      "lib:resguardo/listAssetsByPerson",
      () => listAssetsByPerson(b.companyId, a.person.id),
    ],
  ])("%s", async (_surface, read) => {
    noLeak(await read());
  });

  it.each([
    ["lib:resguardo/getAssetById", () => getAssetById(b.companyId, a.asset.id)],
    [
      "lib:resguardo/getAssetWithHolder",
      () => getAssetWithHolder(b.companyId, a.asset.id),
    ],
  ])("%s", async (_surface, read) => {
    expect(await read()).toBeNull();
  });

  it("lib:resguardo/countAssignedAssets", async () => {
    expect(await countAssignedAssets(b.companyId)).toBe(1);
  });
});

describe("resguardo writes cannot reach another company", () => {
  it("lib:resguardo/createAsset", async () => {
    // A's identifier is free in B.
    const created = await createAsset(
      b.companyId,
      {
        name: "Laptop",
        identifier: a.asset.identifier,
        category: "laptop",
        tracksHistory: true,
      },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it("lib:resguardo/assignAsset", async () => {
    const before = await snapshotTenant(a);
    // A's free asset to B's person, and B's free asset to A's person.
    await expect(
      assignAsset(
        b.companyId,
        { assetId: a.freeAsset.id, personId: b.person.id, ...movement },
        b.admin.id,
      ),
    ).rejects.toThrow("Activo no encontrado.");
    await expect(
      assignAsset(
        b.companyId,
        { assetId: b.freeAsset.id, personId: a.person.id, ...movement },
        b.admin.id,
      ),
    ).rejects.toThrow("Persona no encontrada.");
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it.each([
    [
      "lib:resguardo/returnAsset",
      () =>
        returnAsset(
          b.companyId,
          { assetId: a.asset.id, ...movement },
          b.admin.id,
        ),
    ],
    [
      "lib:resguardo/softDeleteAsset",
      () => softDeleteAsset(b.companyId, a.freeAsset.id, b.admin.id),
    ],
  ])("%s", async (_surface, write) => {
    const before = await snapshotTenant(a);
    await expect(write()).rejects.toThrow("Activo no encontrado.");
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("resguardo actions with company B's session", () => {
  it("action:resguardo/assignAssetAction", async () => {
    actAs(b.admin);
    const result = await assignAssetAction(
      {},
      formData({
        assetId: b.freeAsset.id,
        personId: a.person.id,
        ...movement,
        companyId: b.companyId,
      }),
    );
    expect(result.error).toBe("Persona no encontrada.");
  });

  it("action:resguardo/returnAssetAction", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const result = await returnAssetAction(
      {},
      formData({ assetId: a.asset.id, ...movement, companyId: b.companyId }),
    );
    expect(result.error).toBe("Activo no encontrado.");
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:resguardo/deleteAssetAction", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    await expect(deleteAssetAction(a.freeAsset.id)).rejects.toMatchObject({
      url: expect.stringContaining("error=Activo%20no%20encontrado"),
    });
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:resguardo/createAssetAction", async () => {
    actAs(b.admin);
    const result = await createAssetAction(
      {},
      formData({
        name: "Otra",
        identifier: "OT-1",
        category: "laptop",
        companyId: a.companyId,
      }),
    );
    expect(result.error).toBe("La empresa activa cambió. Recarga la página.");
  });
});

describe("resguardo permissions", () => {
  it.each([
    [
      "rbac:action:resguardo/createAssetAction",
      () =>
        createAssetAction(
          {},
          formData({ name: "x", identifier: "x", category: "x" }),
        ),
    ],
    [
      "rbac:action:resguardo/assignAssetAction",
      () =>
        assignAssetAction(
          {},
          formData({
            assetId: b.freeAsset.id,
            personId: b.person.id,
            ...movement,
          }),
        ),
    ],
    [
      "rbac:action:resguardo/returnAssetAction",
      () =>
        returnAssetAction({}, formData({ assetId: b.asset.id, ...movement })),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.viewer);
    const before = await snapshotTenant(b);
    expect((await run()).error).toMatch(/permiso/);
    expect(await snapshotTenant(b)).toEqual(before);
  });

  it("rbac:action:resguardo/deleteAssetAction", async () => {
    actAs(b.viewer);
    await expect(deleteAssetAction(b.freeAsset.id)).rejects.toMatchObject({
      url: "/app/resguardo?error=delete-permission",
    });
  });
});
