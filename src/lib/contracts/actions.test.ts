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
  requireContractsCreateMock,
  requireContractsUpdateMock,
  createContractMock,
  renewContractMock,
  markContractNoRenewMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireContractsCreateMock: vi.fn(),
  requireContractsUpdateMock: vi.fn(),
  createContractMock: vi.fn(),
  renewContractMock: vi.fn(),
  markContractNoRenewMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/contracts/auth", () => ({
  requireContractsCreate: requireContractsCreateMock,
  requireContractsUpdate: requireContractsUpdateMock,
}));

vi.mock("@/lib/contracts/index", () => ({
  createContract: createContractMock,
  renewContract: renewContractMock,
  markContractNoRenew: markContractNoRenewMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("createContractAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when create permission is missing", async () => {
    requireContractsCreateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: contracts:create"),
    );

    const { createContractAction } = await import("@/lib/contracts/actions");

    const formData = new FormData();
    formData.set("personId", "11111111-1111-1111-1111-111111111111");
    formData.set("type", "determinado");
    formData.set("startDate", "2025-01-01");
    formData.set("endDate", "2025-12-31");
    formData.set("noticeWindow", "3");
    formData.set("templateId", "22222222-2222-2222-2222-222222222222");

    const result = await createContractAction({}, formData);

    expect(result.error).toMatch(/permiso/i);
    expect(createContractMock).not.toHaveBeenCalled();
  });
});

describe("noRenewContractAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when update permission is missing", async () => {
    requireContractsUpdateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: contracts:update"),
    );

    const { noRenewContractAction } = await import("@/lib/contracts/actions");

    await expect(
      noRenewContractAction("33333333-3333-3333-3333-333333333333"),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(markContractNoRenewMock).not.toHaveBeenCalled();
  });
});

describe("renewContractAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("renews without auto-baja on happy path", async () => {
    requireContractsUpdateMock.mockResolvedValue({ user: { id: "user-1" } });
    renewContractMock.mockResolvedValue({
      id: "contract-new",
      personId: "person-1",
    });

    const { renewContractAction } = await import("@/lib/contracts/actions");

    const formData = new FormData();
    formData.set("contractId", "44444444-4444-4444-8444-444444444444");
    formData.set("type", "indeterminado");
    formData.set("startDate", "2026-01-01");
    formData.set("noticeWindow", "no_avisar");
    formData.set("templateId", "22222222-2222-4222-8222-222222222222");

    await expect(renewContractAction({}, formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(renewContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "indeterminado" }),
      "user-1",
    );
  });
});
