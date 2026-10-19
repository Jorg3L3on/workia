/**
 * Cross-company isolation for the catalog: areas, puestos, actividades and
 * sucursales (WRK-I4-10). Test titles are the surface ids of docs/idor-matrix.md.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  assignActivityToPosition,
  countCatalogReferences,
  createActivity,
  createArea,
  createPosition,
  getActivityById,
  getAreaById,
  getPositionById,
  listActiveAreas,
  listActivePositions,
  listActivities,
  listActivitiesByPositionIds,
  listActivitiesForPersonPosition,
  listActivitiesForPosition,
  listAreas,
  listAssignableActivities,
  listPositions,
  softDeleteActivity,
  softDeleteArea,
  softDeletePosition,
  unassignActivityFromPosition,
  updateActivity,
  updateArea,
  updatePosition,
} from "@/lib/catalog";
import {
  assignActivityToPositionAction,
  createActivityAction,
  createAreaAction,
  createPositionAction,
  deleteActivityAction,
  deleteAreaAction,
  deletePositionAction,
  unassignActivityFromPositionAction,
  updateActivityAction,
  updateAreaAction,
  updatePositionAction,
} from "@/lib/catalog/actions";
import {
  createSite,
  getSiteById,
  listActiveSites,
  listSites,
  softDeleteSite,
  updateSite,
} from "@/lib/sites";
import {
  createSiteAction,
  deleteSiteAction,
  updateSiteAction,
} from "@/lib/sites/actions";

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

/** Runs an action that ends in redirect(); returns the URL it redirected to. */
const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  return "no redirect";
};

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("catalog reads stay inside the company", () => {
  it.each([
    [
      "lib:catalog/listAreas",
      () => listAreas(b.companyId, { includeDeleted: true }),
    ],
    ["lib:catalog/listActiveAreas", () => listActiveAreas(b.companyId)],
    [
      "lib:catalog/listPositions",
      () => listPositions(b.companyId, { includeDeleted: true }),
    ],
    ["lib:catalog/listActivePositions", () => listActivePositions(b.companyId)],
    [
      "lib:catalog/listActivities",
      () => listActivities(b.companyId, { includeDeleted: true }),
    ],
    [
      "lib:catalog/listAssignableActivities",
      () => listAssignableActivities(b.companyId),
    ],
    [
      "lib:catalog/listActivitiesForPosition",
      () => listActivitiesForPosition(b.companyId, a.position.id),
    ],
    [
      "lib:catalog/listActivitiesForPersonPosition",
      () => listActivitiesForPersonPosition(b.companyId, a.person.id),
    ],
    [
      "lib:sites/listSites",
      () => listSites(b.companyId, { includeDeleted: true }),
    ],
    ["lib:sites/listActiveSites", () => listActiveSites(b.companyId)],
    [
      "lib:catalog/countCatalogReferences",
      () => countCatalogReferences(b.companyId),
    ],
  ])("%s", async (_surface, read) => {
    noLeak(await read());
  });

  it("lib:catalog/listActivitiesByPositionIds", async () => {
    // Keys echo the ids asked for; A's puesto gets no activities in B.
    const grouped = await listActivitiesByPositionIds(b.companyId, [
      a.position.id,
      b.position.id,
    ]);
    expect(grouped.get(a.position.id)).toEqual([]);
    noLeak([...grouped.values()]);
  });

  it("lib:catalog/listActivePositions filtered by another company's area", async () => {
    expect(await listActivePositions(b.companyId, a.area.id)).toEqual([]);
  });

  it.each([
    ["lib:catalog/getAreaById", () => getAreaById(b.companyId, a.area.id)],
    [
      "lib:catalog/getPositionById",
      () => getPositionById(b.companyId, a.position.id),
    ],
    [
      "lib:catalog/getActivityById",
      () => getActivityById(b.companyId, a.activity.id),
    ],
    ["lib:sites/getSiteById", () => getSiteById(b.companyId, a.site.id)],
  ])("%s", async (_surface, read) => {
    expect(await read()).toBeNull();
  });
});

describe("catalog writes cannot reach another company", () => {
  it("lib:catalog/createArea", async () => {
    await expect(
      createArea(
        b.companyId,
        { name: "Hija", parentAreaId: a.area.id, active: true },
        b.admin.id,
      ),
    ).rejects.toMatchObject({ name: "CompanyReferenceError" });
    // A name used in A is free in B.
    const same = await createArea(
      b.companyId,
      { name: a.area.name, active: true },
      b.admin.id,
    );
    expect(same.companyId).toBe(b.companyId);
  });

  it("lib:catalog/createPosition", async () => {
    await expect(
      createPosition(
        b.companyId,
        { name: "Puesto", areaId: a.area.id, active: true },
        b.admin.id,
      ),
    ).rejects.toMatchObject({ name: "CompanyReferenceError" });
  });

  it("lib:catalog/createActivity", async () => {
    const created = await createActivity(
      b.companyId,
      { name: a.activity.name, active: true },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it("lib:sites/createSite", async () => {
    const created = await createSite(
      b.companyId,
      { name: a.site.name, kind: "sucursal" },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it.each([
    [
      "lib:catalog/updateArea",
      () =>
        updateArea(
          b.companyId,
          a.area.id,
          { name: "x", active: true },
          b.admin.id,
        ),
    ],
    [
      "lib:catalog/softDeleteArea",
      () => softDeleteArea(b.companyId, a.area.id, b.admin.id),
    ],
    [
      "lib:catalog/updatePosition",
      () =>
        updatePosition(
          b.companyId,
          a.position.id,
          { name: "x", active: true },
          b.admin.id,
        ),
    ],
    [
      "lib:catalog/softDeletePosition",
      () => softDeletePosition(b.companyId, a.position.id, b.admin.id),
    ],
    [
      "lib:catalog/updateActivity",
      () =>
        updateActivity(
          b.companyId,
          a.activity.id,
          { name: "x", active: true },
          b.admin.id,
        ),
    ],
    [
      "lib:catalog/softDeleteActivity",
      () => softDeleteActivity(b.companyId, a.activity.id, b.admin.id),
    ],
    [
      "lib:sites/updateSite",
      () =>
        updateSite(
          b.companyId,
          a.site.id,
          { name: "x", kind: "sucursal" },
          b.admin.id,
        ),
    ],
    [
      "lib:sites/softDeleteSite",
      () => softDeleteSite(b.companyId, a.site.id, b.admin.id),
    ],
  ])("%s", async (_surface, write) => {
    const before = await snapshotTenant(a);
    expect(await write()).toBeNull();
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("lib:catalog/assignActivityToPosition", async () => {
    // A's activity on B's puesto, and B's activity on A's puesto.
    expect(
      await assignActivityToPosition(
        b.companyId,
        b.position.id,
        a.activity.id,
        b.admin.id,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await assignActivityToPosition(
        b.companyId,
        a.position.id,
        b.activity.id,
        b.admin.id,
      ),
    ).toMatchObject({ ok: false });
  });

  it("lib:catalog/unassignActivityFromPosition", async () => {
    const before = await snapshotTenant(a);
    await unassignActivityFromPosition(
      b.companyId,
      a.position.id,
      a.activity.id,
      b.admin.id,
    );
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("catalog actions with company B's session", () => {
  it.each([
    ["action:catalog/deleteAreaAction", () => deleteAreaAction(a.area.id)],
    [
      "action:catalog/deletePositionAction",
      () => deletePositionAction(a.position.id),
    ],
    [
      "action:catalog/deleteActivityAction",
      () => deleteActivityAction(a.activity.id),
    ],
    ["action:sites/deleteSiteAction", () => deleteSiteAction(a.site.id)],
    [
      "action:catalog/updateActivityAction",
      () =>
        updateActivityAction(
          a.activity.id,
          formData({ name: "Robada", active: "on", companyId: b.companyId }),
        ),
    ],
    [
      "action:catalog/updateAreaAction",
      () =>
        updateAreaAction(
          a.area.id,
          formData({ name: "Robada", active: "true", companyId: b.companyId }),
        ),
    ],
    [
      "action:catalog/updatePositionAction",
      () =>
        updatePositionAction(
          a.position.id,
          formData({
            name: "Robado",
            active: "true",
            syncActivities: "true",
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "action:sites/updateSiteAction",
      () =>
        updateSiteAction(
          a.site.id,
          formData({
            name: "Robada",
            kind: "sucursal",
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "action:catalog/unassignActivityFromPositionAction",
      () =>
        unassignActivityFromPositionAction(
          formData({
            positionId: a.position.id,
            activityId: a.activity.id,
            companyId: b.companyId,
          }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    await redirectOf(run);
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:catalog/createAreaAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        createAreaAction(
          formData({
            name: "Hija de A",
            parentAreaId: a.area.id,
            active: "on",
            companyId: b.companyId,
          }),
        ),
      ),
    ).toContain("error=reference");
  });

  it("action:catalog/createPositionAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        createPositionAction(
          formData({
            name: "Puesto de A",
            areaId: a.area.id,
            active: "on",
            companyId: b.companyId,
          }),
        ),
      ),
    ).toContain("error=reference");
  });

  it("action:catalog/createActivityAction", async () => {
    actAs(b.admin);
    // Form opened in A, submitted with B active: refused.
    expect(
      await redirectOf(() =>
        createActivityAction(
          formData({ name: "Otra", active: "on", companyId: a.companyId }),
        ),
      ),
    ).toContain("error=company-changed");
  });

  it("action:catalog/assignActivityToPositionAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        assignActivityToPositionAction(
          formData({
            positionId: b.position.id,
            activityId: a.activity.id,
            companyId: b.companyId,
          }),
        ),
      ),
    ).toContain("error=activity-not-assignable");
  });

  it("action:sites/createSiteAction", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        createSiteAction(
          formData({ name: "Otra", kind: "sucursal", companyId: a.companyId }),
        ),
      ),
    ).toContain("error=company-changed");
  });

  it("updatePositionAction syncs the sheet's activity chips", async () => {
    actAs(b.admin);
    const form = (activityIds: string[]) => {
      const data = formData({
        name: b.position.name,
        active: "true",
        syncActivities: "true",
        companyId: b.companyId,
      });
      for (const id of activityIds) data.append("activityId", id);
      return data;
    };

    expect(
      await redirectOf(() =>
        updatePositionAction(b.position.id, form([b.activity.id])),
      ),
    ).toContain("saved=position");
    expect(
      (await listActivitiesForPosition(b.companyId, b.position.id)).map(
        (activity) => activity.id,
      ),
    ).toContain(b.activity.id);

    await redirectOf(() => updatePositionAction(b.position.id, form([])));
    expect(await listActivitiesForPosition(b.companyId, b.position.id)).toEqual(
      [],
    );
  });

  it("updateAreaAction refuses an area under itself", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        updateAreaAction(
          b.area.id,
          formData({
            name: b.area.name,
            parentAreaId: b.area.id,
            active: "true",
            companyId: b.companyId,
          }),
        ),
      ),
    ).toContain("error=area-cycle");
  });

  it("reports a duplicate name in the same company", async () => {
    actAs(b.admin);
    expect(
      await redirectOf(() =>
        createAreaAction(
          formData({
            name: b.area.name.toUpperCase(),
            active: "on",
            companyId: b.companyId,
          }),
        ),
      ),
    ).toContain("error=duplicate-name");
  });
});

describe("catalog permissions", () => {
  it.each([
    [
      "rbac:action:catalog/createAreaAction",
      () => createAreaAction(formData({ name: "x", companyId: b.companyId })),
    ],
    ["rbac:action:catalog/deleteAreaAction", () => deleteAreaAction(b.area.id)],
    [
      "rbac:action:catalog/createPositionAction",
      () =>
        createPositionAction(formData({ name: "x", companyId: b.companyId })),
    ],
    [
      "rbac:action:catalog/deletePositionAction",
      () => deletePositionAction(b.position.id),
    ],
    [
      "rbac:action:catalog/createActivityAction",
      () =>
        createActivityAction(formData({ name: "x", companyId: b.companyId })),
    ],
    [
      "rbac:action:catalog/updateActivityAction",
      () =>
        updateActivityAction(
          b.activity.id,
          formData({ name: "x", companyId: b.companyId }),
        ),
    ],
    [
      "rbac:action:catalog/updateAreaAction",
      () =>
        updateAreaAction(
          b.area.id,
          formData({ name: "x", companyId: b.companyId }),
        ),
    ],
    [
      "rbac:action:catalog/updatePositionAction",
      () =>
        updatePositionAction(
          b.position.id,
          formData({ name: "x", companyId: b.companyId }),
        ),
    ],
    [
      "rbac:action:sites/updateSiteAction",
      () =>
        updateSiteAction(
          b.site.id,
          formData({ name: "x", kind: "sucursal", companyId: b.companyId }),
        ),
    ],
    [
      "rbac:action:catalog/deleteActivityAction",
      () => deleteActivityAction(b.activity.id),
    ],
    [
      "rbac:action:catalog/assignActivityToPositionAction",
      () =>
        assignActivityToPositionAction(
          formData({
            positionId: b.position.id,
            activityId: b.activity.id,
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "rbac:action:catalog/unassignActivityFromPositionAction",
      () =>
        unassignActivityFromPositionAction(
          formData({
            positionId: b.position.id,
            activityId: b.activity.id,
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "rbac:action:sites/createSiteAction",
      () =>
        createSiteAction(
          formData({ name: "x", kind: "sucursal", companyId: b.companyId }),
        ),
    ],
    ["rbac:action:sites/deleteSiteAction", () => deleteSiteAction(b.site.id)],
  ])("%s", async (_surface, run) => {
    actAs(b.viewer);
    const before = await snapshotTenant(b);
    expect(await redirectOf(run)).toMatch(
      /error=(areas|positions|activities|sites)-/,
    );
    expect(await snapshotTenant(b)).toEqual(before);
  });
});
