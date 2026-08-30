import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/lib/rbac/errors";

vi.mock("@/env", () => ({
  env: {
    DATABASE_URL:
      "postgresql://user:password@localhost:5432/workia?sslmode=disable",
    AUTH_SECRET: "ci-auth-secret-with-at-least-32-characters",
    NODE_ENV: "test",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

const {
  requireAssetsCreateMock,
  requireAssetsUpdateMock,
  createAssetMock,
  assignAssetMock,
  returnAssetMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireAssetsCreateMock: vi.fn(),
  requireAssetsUpdateMock: vi.fn(),
  createAssetMock: vi.fn(),
  assignAssetMock: vi.fn(),
  returnAssetMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/resguardo/auth", () => ({
  requireAssetsCreate: requireAssetsCreateMock,
  requireAssetsUpdate: requireAssetsUpdateMock,
}));

vi.mock("@/lib/resguardo", () => ({
  createAsset: createAssetMock,
  assignAsset: assignAssetMock,
  returnAsset: returnAssetMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("createAssetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when create permission is missing", async () => {
    requireAssetsCreateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: assets:create"),
    );

    const { createAssetAction } = await import("@/lib/resguardo/actions");

    const formData = new FormData();
    formData.set("name", "Laptop demo");
    formData.set("identifier", "SERIE-001");
    formData.set("category", "laptop");
    formData.set("tracksHistory", "true");

    const result = await createAssetAction({}, formData);

    expect(result.error).toMatch(/permiso/i);
    expect(createAssetMock).not.toHaveBeenCalled();
  });
});

describe("assignAssetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when update permission is missing", async () => {
    requireAssetsUpdateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: assets:update"),
    );

    const { assignAssetAction } = await import("@/lib/resguardo/actions");

    const formData = new FormData();
    formData.set("assetId", "11111111-1111-4111-8111-111111111111");
    formData.set("personId", "22222222-2222-4222-8222-222222222222");
    formData.set("movementDate", "2026-01-01");
    formData.set("conditionNote", "Buen estado");

    const result = await assignAssetAction({}, formData);

    expect(result.error).toMatch(/permiso/i);
    expect(assignAssetMock).not.toHaveBeenCalled();
  });
});

describe("returnAssetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("registers devolución on happy path", async () => {
    requireAssetsUpdateMock.mockResolvedValue({ user: { id: "user-1" } });
    returnAssetMock.mockResolvedValue({
      asset: { id: "asset-1", holderId: null },
      movement: { personId: "person-1" },
    });

    const { returnAssetAction } = await import("@/lib/resguardo/actions");

    const formData = new FormData();
    formData.set("assetId", "11111111-1111-4111-8111-111111111111");
    formData.set("movementDate", "2026-02-01");
    formData.set("conditionNote", "Buen estado");

    await expect(returnAssetAction({}, formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(returnAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ conditionNote: "Buen estado" }),
      "user-1",
    );
  });
});
