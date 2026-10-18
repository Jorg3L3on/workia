import { describe, expect, it } from "vitest";

import { ROLES, type PermissionSlug } from "@/lib/db/schema/types";

import {
  applyClientCeiling,
  effectivePermissions,
  grantableScopes,
  MCP_SCOPES,
  parseScopeParam,
  scopeForPermission,
} from "./scopes";

const rolePermissions = (slug: string) =>
  new Set<PermissionSlug>(
    ROLES.find((role) => role.slug === slug)!.permissions as PermissionSlug[],
  );

describe("ChatGPT ceiling (D-01, D-05)", () => {
  it("keeps at most read, audit and offline_access", () => {
    expect(
      applyClientCeiling([...MCP_SCOPES], { isChatgpt: true }).sort(),
    ).toEqual(["audit", "offline_access", "read"]);
  });

  it("allows pii only when a super_admin chose it, and never write:*", () => {
    const scopes = applyClientCeiling([...MCP_SCOPES], {
      isChatgpt: true,
      allowChatgptPii: true,
    });

    expect(scopes).toContain("pii");
    expect(scopes.some((scope) => scope.startsWith("write:"))).toBe(false);
  });

  it("does not cap other clients (the role still applies)", () => {
    expect(
      applyClientCeiling(["read", "write:assets"], { isChatgpt: false }),
    ).toEqual(["read", "write:assets"]);
  });
});

describe("grantable scopes follow the role", () => {
  it("offers pii to any role with people:update, editor included (D-09)", () => {
    expect(grantableScopes(rolePermissions("editor"))).toContain("pii");
    expect(grantableScopes(rolePermissions("viewer"))).not.toContain("pii");
  });

  it("offers audit only with audit:read and writes only with their permissions", () => {
    const viewer = grantableScopes(rolePermissions("viewer"));
    const editor = grantableScopes(rolePermissions("editor"));

    expect(viewer).toEqual(["read", "offline_access"]);
    expect(editor).not.toContain("audit");
    expect(editor).toContain("write:people");
    expect(editor).toContain("write:assets");
    expect(editor).not.toContain("write:catalog");
    expect(grantableScopes(rolePermissions("admin"))).toEqual([...MCP_SCOPES]);
  });
});

describe("effective permissions", () => {
  it("are the role's permissions the scopes cover, never deletes or admin ones", () => {
    const admin = rolePermissions("admin");

    expect(effectivePermissions(admin, ["read"])).not.toContain("audit:read");
    expect(effectivePermissions(admin, ["read", "audit"])).toContain(
      "audit:read",
    );
    expect(effectivePermissions(admin, ["read", "write:people"])).toContain(
      "people:update",
    );

    const all = effectivePermissions(admin, [...MCP_SCOPES]);
    expect(all.some((slug) => slug.endsWith(":delete"))).toBe(false);
    expect(all).not.toContain("members:manage");
    expect(all).not.toContain("people:import");
  });

  it("maps every permission to a scope or to nothing", () => {
    expect(scopeForPermission("contracts:read")).toBe("read");
    expect(scopeForPermission("sites:create")).toBe("write:catalog");
    expect(scopeForPermission("people:delete")).toBeNull();
    expect(scopeForPermission("mcp_connections:create")).toBeNull();
  });
});

it("parses scope parameters, implying read and dropping unknown values", () => {
  expect(parseScopeParam("audit write:assets admin offline_access")).toEqual([
    "read",
    "audit",
    "write:assets",
    "offline_access",
  ]);
  expect(parseScopeParam(null)).toEqual(["read"]);
});
