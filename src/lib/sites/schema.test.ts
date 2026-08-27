import { describe, expect, it } from "vitest";

import { siteFormSchema, siteKindLabels } from "@/lib/sites/schema";

describe("siteFormSchema", () => {
  it("accepts corporativo and sucursal kinds", () => {
    const corporativo = siteFormSchema.safeParse({
      name: "Corporativo Demo",
      kind: "corporativo",
    });
    const sucursal = siteFormSchema.safeParse({
      name: "Sucursal Demo Norte",
      kind: "sucursal",
    });

    expect(corporativo.success).toBe(true);
    expect(sucursal.success).toBe(true);
  });

  it("rejects empty name", () => {
    const parsed = siteFormSchema.safeParse({
      name: "",
      kind: "sucursal",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("siteKindLabels", () => {
  it("labels kinds in Spanish", () => {
    expect(siteKindLabels.corporativo).toBe("Corporativo");
    expect(siteKindLabels.sucursal).toBe("Sucursal");
  });
});

describe("sites permissions catalog", () => {
  it("includes sites CRUD slugs", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("sites:read");
    expect(slugs).toContain("sites:create");
    expect(slugs).toContain("sites:delete");
  });
});
