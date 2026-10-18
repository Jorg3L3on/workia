/**
 * Regions over sites (WRK-I5-4): cross-company isolation, sites:* permissions,
 * and the region filters of Personas and the renewal tray. Test titles are the
 * surface ids of docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { listRenewalTrayItems } from "@/lib/contracts";
import { contracts, people, regions, sites } from "@/lib/db/schema";
import { listPeoplePage } from "@/lib/people";
import {
  createRegion,
  getRegionById,
  listRegions,
  listRegionsWithSiteCounts,
  softDeleteRegion,
  updateRegion,
} from "@/lib/regions";
import {
  createRegionAction,
  deleteRegionAction,
  updateRegionAction,
} from "@/lib/regions/actions";
import { createSite, setSiteRegion } from "@/lib/sites";
import { setSiteRegionAction } from "@/lib/sites/actions";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let regionA: typeof regions.$inferSelect;
let regionB: typeof regions.$inferSelect;

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

const regionRow = async (id: string) =>
  (await ownerDb.select().from(regions).where(eq(regions.id, id)))[0];
const siteRow = async (id: string) =>
  (await ownerDb.select().from(sites).where(eq(sites.id, id)))[0];

beforeAll(async () => {
  a = await seedTenant("RA");
  b = await seedTenant("RB");
  regionA = await createRegion(
    a.companyId,
    { name: "Norte A", active: true },
    a.admin.id,
  );
  regionB = await createRegion(
    b.companyId,
    { name: "Norte B", active: true },
    b.admin.id,
  );
  await setSiteRegion(a.companyId, a.site.id, regionA.id, a.admin.id);
});

describe("regions stay inside the company", () => {
  it("lib:regions/listRegions", async () => {
    const rows = await listRegions(b.companyId);
    expect(rows.map((row) => row.id)).toEqual([regionB.id]);
  });

  it("lib:regions/listRegionsWithSiteCounts", async () => {
    const rows = await listRegionsWithSiteCounts(b.companyId);
    expect(idsIn(rows)).not.toContain(regionA.id);
    expect(rows[0]).toMatchObject({ id: regionB.id, siteCount: 0 });
    const own = await listRegionsWithSiteCounts(a.companyId);
    expect(own[0]).toMatchObject({ id: regionA.id, siteCount: 1 });
  });

  it("lib:regions/getRegionById", async () => {
    expect(await getRegionById(b.companyId, regionA.id)).toBeNull();
  });

  it("lib:regions/createRegion", async () => {
    const created = await createRegion(
      b.companyId,
      { name: "Norte A", active: true },
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
    await expect(
      createRegion(b.companyId, { name: "norte a", active: true }, b.admin.id),
    ).rejects.toMatchObject({ name: "DuplicateNameError" });
  });

  it("lib:regions/updateRegion", async () => {
    expect(
      await updateRegion(
        b.companyId,
        regionA.id,
        { name: "Robada", active: false },
        b.admin.id,
      ),
    ).toBeNull();
    expect((await regionRow(regionA.id)).name).toBe("Norte A");
  });

  it("lib:regions/softDeleteRegion", async () => {
    expect(
      await softDeleteRegion(b.companyId, regionA.id, b.admin.id),
    ).toBeNull();
    expect((await regionRow(regionA.id)).deletedAt).toBeNull();
  });

  it("lib:sites/setSiteRegion", async () => {
    // B's region on A's site, and A's region on B's site.
    expect(
      await setSiteRegion(b.companyId, a.site.id, regionB.id, b.admin.id),
    ).toBeNull();
    await expect(
      setSiteRegion(b.companyId, b.site.id, regionA.id, b.admin.id),
    ).rejects.toMatchObject({ name: "RegionNotFoundError" });
    await expect(
      createSite(
        b.companyId,
        { name: "Con región ajena", kind: "sucursal", regionId: regionA.id },
        b.admin.id,
      ),
    ).rejects.toMatchObject({ name: "RegionNotFoundError" });
    expect((await siteRow(a.site.id)).regionId).toBe(regionA.id);
    expect((await siteRow(b.site.id)).regionId).toBeNull();
  });
});

describe("region actions with company B's session", () => {
  it("action:regions/updateRegionAction", async () => {
    actAs(b.admin);
    await redirectOf(() =>
      updateRegionAction(
        regionA.id,
        formData({ name: "Robada", active: "true", companyId: b.companyId }),
      ),
    );
    expect((await regionRow(regionA.id)).name).toBe("Norte A");
  });

  it("action:regions/deleteRegionAction", async () => {
    actAs(b.admin);
    await redirectOf(() => deleteRegionAction(regionA.id));
    expect((await regionRow(regionA.id)).deletedAt).toBeNull();
  });

  it("action:regions/createRegionAction", async () => {
    actAs(b.admin);
    const url = await redirectOf(() =>
      createRegionAction(formData({ name: "Sur", companyId: a.companyId })),
    );
    // A form opened in another company is refused.
    expect(url).toMatch(/error=company-changed/);
    expect(
      (await listRegions(a.companyId)).map((row) => row.name),
    ).not.toContain("Sur");
  });

  it("action:sites/setSiteRegionAction", async () => {
    actAs(b.admin);
    await redirectOf(() =>
      setSiteRegionAction(
        a.site.id,
        formData({ regionId: regionB.id, companyId: b.companyId }),
      ),
    );
    expect((await siteRow(a.site.id)).regionId).toBe(regionA.id);
  });
});

describe("region permissions (sites:*)", () => {
  it.each([
    [
      "rbac:action:regions/createRegionAction",
      () =>
        createRegionAction(formData({ name: "Vista", companyId: b.companyId })),
    ],
    [
      "rbac:action:regions/updateRegionAction",
      () =>
        updateRegionAction(
          regionB.id,
          formData({ name: "Vista", active: "true", companyId: b.companyId }),
        ),
    ],
    [
      "rbac:action:regions/deleteRegionAction",
      () => deleteRegionAction(regionB.id),
    ],
    [
      "rbac:action:sites/setSiteRegionAction",
      () =>
        setSiteRegionAction(
          b.site.id,
          formData({ regionId: regionB.id, companyId: b.companyId }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.viewer);
    expect(await redirectOf(run)).toMatch(/error=(regions|sites)-/);
    expect(await regionRow(regionB.id)).toMatchObject({
      name: "Norte B",
      deletedAt: null,
    });
    expect((await siteRow(b.site.id)).regionId).toBeNull();
  });
});

describe("region filters and logical delete", () => {
  it("Personas and the renewal tray filter by region", async () => {
    // A's person works at A's site (in Norte A); the teammate has no site.
    await ownerDb
      .update(people)
      .set({ siteId: a.site.id })
      .where(eq(people.id, a.person.id));
    await ownerDb
      .update(contracts)
      .set({ type: "determinado", endDate: "2026-11-30", noticeWindow: "3" })
      .where(eq(contracts.id, a.contract.id));

    const inRegion = await listPeoplePage(a.companyId, {
      regionId: regionA.id,
      page: 1,
      pageSize: 50,
    });
    expect(inRegion.rows.map((row) => row.id)).toEqual([a.person.id]);

    const otherRegion = await createRegion(
      a.companyId,
      { name: "Sur A", active: true },
      a.admin.id,
    );
    expect(
      (
        await listPeoplePage(a.companyId, {
          regionId: otherRegion.id,
          page: 1,
          pageSize: 50,
        })
      ).total,
    ).toBe(0);

    const tray = await listRenewalTrayItems(a.companyId, "2026-10-01", 50, {
      regionId: regionA.id,
    });
    expect(tray.map((item) => item.contract.id)).toEqual([a.contract.id]);
    expect(
      await listRenewalTrayItems(a.companyId, "2026-10-01", 50, {
        regionId: otherRegion.id,
      }),
    ).toEqual([]);
  });

  it("an inactive region cannot be assigned; deleting one frees its sites", async () => {
    const paused = await createRegion(
      a.companyId,
      { name: "Pausada", active: false },
      a.admin.id,
    );
    await expect(
      setSiteRegion(a.companyId, a.site.id, paused.id, a.admin.id),
    ).rejects.toMatchObject({ name: "RegionNotFoundError" });

    await softDeleteRegion(a.companyId, regionA.id, a.admin.id);
    expect((await siteRow(a.site.id)).regionId).toBeNull();
    expect((await listRegions(a.companyId)).map((row) => row.id)).not.toContain(
      regionA.id,
    );
  });
});
