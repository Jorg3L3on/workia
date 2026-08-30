import { describe, expect, it } from "vitest";

import {
  activityFormSchema,
  buildAreaTree,
  isActivityAssignable,
  positionActivityFormSchema,
} from "@/lib/catalog/schema";

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

describe("activityFormSchema", () => {
  it("accepts a dummy Spanish activity name", () => {
    const parsed = activityFormSchema.safeParse({
      name: "Atención a solicitudes internas",
      active: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const parsed = activityFormSchema.safeParse({
      name: "   ",
      active: true,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("positionActivityFormSchema", () => {
  it("requires two UUIDs", () => {
    const parsed = positionActivityFormSchema.safeParse({
      positionId: "11111111-1111-4111-8111-111111111111",
      activityId: "22222222-2222-4222-8222-222222222222",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects missing ids", () => {
    const parsed = positionActivityFormSchema.safeParse({
      positionId: "",
      activityId: "",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("isActivityAssignable", () => {
  it("allows only active, non-deleted activities", () => {
    expect(isActivityAssignable({ active: true, deletedAt: null })).toBe(true);
    expect(isActivityAssignable({ active: false, deletedAt: null })).toBe(
      false,
    );
    expect(
      isActivityAssignable({
        active: true,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(false);
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

  it("reuses positions permissions for activities", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs.some((slug) => slug.startsWith("activities:"))).toBe(false);
  });
});
