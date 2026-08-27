import { describe, expect, it } from "vitest";

import { buildAreaTree } from "@/lib/catalog/schema";

describe("buildAreaTree", () => {
  it("nests child areas under their parent", () => {
    const tree = buildAreaTree([
      {
        id: "root",
        name: "Operaciones",
        active: true,
        deletedAt: null,
        parentAreaId: null,
      },
      {
        id: "child",
        name: "Sucursal Norte",
        active: true,
        deletedAt: null,
        parentAreaId: "root",
      },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("Operaciones");
    expect(tree[0]?.children[0]?.name).toBe("Sucursal Norte");
  });

  it("marks deleted areas in the tree data", () => {
    const deletedAt = new Date("2024-01-01T00:00:00Z");

    const tree = buildAreaTree([
      {
        id: "deleted",
        name: "Archivada",
        active: false,
        deletedAt,
        parentAreaId: null,
      },
    ]);

    expect(tree[0]?.deletedAt).toEqual(deletedAt);
  });
});

describe("catalog permissions catalog", () => {
  it("includes area and position CRUD slugs", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("areas:create");
    expect(slugs).toContain("areas:delete");
    expect(slugs).toContain("positions:create");
    expect(slugs).toContain("positions:delete");
  });
});
