import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { people } from "@/lib/db/schema";
import { PLATFORM_PERMISSIONS, ROLES } from "@/lib/db/schema/types";

import {
  combinePermissions,
  pickActiveMembership,
  type ActiveMembership,
} from "./memberships";
import {
  assertTenantOwnership,
  CrossTenantError,
  resolveWritableCompanyId,
  tenantScope,
} from "./scope";

const membership = (
  companyId: string,
  overrides: Partial<ActiveMembership> = {},
): ActiveMembership => ({
  membershipId: `m-${companyId}`,
  companyId,
  companyName: companyId,
  companySlug: companyId,
  roleId: "role",
  roleSlug: "viewer",
  roleName: "Viewer",
  isDefault: false,
  ...overrides,
});

describe("pickActiveMembership", () => {
  const a = membership("A");
  const b = membership("B", { isDefault: true });

  it("honours the company the session chose while the user still belongs to it", () => {
    expect(pickActiveMembership([a, b], "A")).toBe(a);
  });

  it("falls back to the default company when the chosen one is gone", () => {
    expect(pickActiveMembership([a, b], "revoked")).toBe(b);
    expect(pickActiveMembership([a, b], null)).toBe(b);
  });

  it("uses the only company when there is no default", () => {
    expect(pickActiveMembership([a])).toBe(a);
  });

  it("returns null with no company, or several and no default", () => {
    expect(pickActiveMembership([])).toBeNull();
    expect(pickActiveMembership([a, membership("C")])).toBeNull();
  });
});

describe("combinePermissions", () => {
  it("never grants platform permissions through a company role", () => {
    const superAdmin = ROLES.find((role) => role.slug === "super_admin")!;
    const combined = combinePermissions(
      [...superAdmin.permissions, "companies:manage", "users:read"],
      false,
    );

    for (const slug of PLATFORM_PERMISSIONS) {
      expect(combined.has(slug)).toBe(false);
    }
    expect(combined.has("people:read")).toBe(true);
  });

  it("adds platform permissions for a platform admin, even without a company", () => {
    const combined = combinePermissions([], true);

    expect(combined.has("companies:manage")).toBe(true);
    expect(combined.has("people:read")).toBe(false);
  });

  it("gives an admin in A and a viewer in B only what each role allows", () => {
    const admin = ROLES.find((role) => role.slug === "admin")!.permissions;
    const viewer = ROLES.find((role) => role.slug === "viewer")!.permissions;

    expect(combinePermissions(admin, false).has("people:delete")).toBe(true);
    expect(combinePermissions(viewer, false).has("people:delete")).toBe(false);
  });
});

describe("tenant scope helpers", () => {
  it("filters by company_id", () => {
    const condition = tenantScope({ companyId: people.id }, "company-a");
    expect(condition).toBeDefined();
  });

  it("accepts a row of the company and rejects another company's row or none", () => {
    expect(assertTenantOwnership({ companyId: "A", id: 1 }, "A")).toEqual({
      companyId: "A",
      id: 1,
    });
    expect(() => assertTenantOwnership({ companyId: "B" }, "A")).toThrow(
      CrossTenantError,
    );
    expect(() => assertTenantOwnership(null, "A")).toThrow(CrossTenantError);
  });

  it("writes only to the active company and refuses a different requested one", () => {
    expect(resolveWritableCompanyId({ companyId: "A" })).toBe("A");
    expect(resolveWritableCompanyId({ companyId: "A" }, "A")).toBe("A");
    expect(() => resolveWritableCompanyId({ companyId: "A" }, "B")).toThrow(
      CrossTenantError,
    );
  });
});
