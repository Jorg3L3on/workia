import { describe, expect, it } from "vitest";

import { AuthorizationError } from "@/lib/rbac/errors";

describe("AuthorizationError", () => {
  it("uses the expected error name", () => {
    const error = new AuthorizationError("Missing permission: users:read");

    expect(error.name).toBe("AuthorizationError");
    expect(error.message).toBe("Missing permission: users:read");
  });
});

describe("PERMISSIONS catalog", () => {
  it("includes unique permission slugs", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("users:read");
    expect(slugs).toContain("content:update");
  });
});

describe("people import/export permissions", () => {
  it("are in the catalog and granted to super_admin and admin only", async () => {
    const { PERMISSIONS, ROLES } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("people:import");
    expect(slugs).toContain("people:export");

    for (const role of ROLES) {
      const permissions: readonly string[] = role.permissions;
      const granted = permissions.includes("people:import");

      expect(granted).toBe(["super_admin", "admin"].includes(role.slug));
      expect(permissions.includes("people:export")).toBe(granted);
    }
  });
});
