import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/lib/rbac/errors";

const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({ requirePermission: requirePermissionMock }));
// The company context checks the first permission; extra ones go through rbac.
vi.mock("@/lib/tenant/context", () => ({
  requireCompanyContext: async (permission: string) => {
    await requirePermissionMock("u1", permission);
    return { user: { id: "u1" }, companyId: "c1" };
  },
}));

const grant = (granted: string[]) =>
  requirePermissionMock.mockImplementation(
    async (_id: string, slug: string) => {
      if (!granted.includes(slug)) {
        throw new AuthorizationError(`Missing permission: ${slug}`);
      }
    },
  );

describe("import/export guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects import without people:import", async () => {
    grant(["people:create", "people:update"]);
    const { requirePeopleImport } = await import("@/lib/people/auth");

    await expect(requirePeopleImport()).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("allows import with the import, create and update permissions", async () => {
    grant(["people:import", "people:create", "people:update"]);
    const { requirePeopleImport } = await import("@/lib/people/auth");

    await expect(requirePeopleImport()).resolves.toBeTruthy();
  });

  it("rejects export without people:export or without people:read", async () => {
    const { requirePeopleExport } = await import("@/lib/people/auth");

    grant(["people:read"]);
    await expect(requirePeopleExport()).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    grant(["people:export"]);
    await expect(requirePeopleExport()).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    grant(["people:export", "people:read"]);
    await expect(requirePeopleExport()).resolves.toBeTruthy();
  });
});
