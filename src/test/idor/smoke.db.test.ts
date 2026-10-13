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
