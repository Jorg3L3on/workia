import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/lib/rbac/errors";

const { requireAuthMock, requirePermissionMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/rbac", () => ({ requirePermission: requirePermissionMock }));

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
    requireAuthMock.mockResolvedValue({ user: { id: "u1" } });
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
