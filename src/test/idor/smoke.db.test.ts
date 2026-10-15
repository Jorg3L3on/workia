import { describe, expect, it } from "vitest";

import { getCompanyContext } from "@/lib/tenant/context";

import { seedTenant } from "./fixtures";
import { actAs } from "./session-state";

describe("harness", () => {
  it("resolves the company context of whoever the test acts as, per call", async () => {
    const a = await seedTenant("A");
    const b = await seedTenant("B");

    actAs(a.admin);
    expect((await getCompanyContext())?.companyId).toBe(a.companyId);
    actAs(b.admin);
    expect((await getCompanyContext())?.companyId).toBe(b.companyId);
  });
});

describe("row-level security mode (npm run test:db:rls)", () => {
  it.runIf(process.env.DATABASE_RLS === "1")(
    "hides every business row from an unscoped query and shows the company's to a scoped one",
    async () => {
      const { db, tdb } = await import("@/lib/db");
      const { people } = await import("@/lib/db/schema");
      const tenant = await seedTenant("R");

      expect(await db.select().from(people)).toEqual([]);
      const scoped = await tdb(tenant.companyId).select().from(people);
      expect(scoped.map((row) => row.companyId)).toEqual(
        scoped.map(() => tenant.companyId),
      );
      expect(scoped.length).toBeGreaterThan(0);
    },
  );
});
