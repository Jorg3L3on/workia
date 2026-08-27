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

const { requirePeopleCreateMock, createPersonMock, redirectMock } = vi.hoisted(
  () => ({
    requirePeopleCreateMock: vi.fn(),
    createPersonMock: vi.fn(),
    redirectMock: vi.fn(),
  }),
);

vi.mock("@/lib/people/auth", () => ({
  requirePeopleCreate: requirePeopleCreateMock,
}));

vi.mock("@/lib/people/index", () => ({
  createPerson: createPersonMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("createPersonAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when create permission is missing", async () => {
    requirePeopleCreateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: people:create"),
    );

    const { createPersonAction } = await import("@/lib/people/actions");

    const formData = new FormData();
    formData.set("nombres", "Persona");
    formData.set("apellidoPaterno", "Demo");
    formData.set("apellidoMaterno", "");
    formData.set("email", "");
    formData.set("telefono", "");
    formData.set("fechaNacimiento", "");
    formData.set("fechaIngreso", "");
    formData.set("areaId", "");
    formData.set("positionId", "");
    formData.set("managerId", "");
    formData.set("siteId", "");
    formData.set("rfc", "");
    formData.set("curp", "");
    formData.set("nss", "");
    formData.set("status", "activa");

    const result = await createPersonAction({}, formData);

    expect(result.error).toMatch(/permiso/i);
    expect(createPersonMock).not.toHaveBeenCalled();
  });

  it("creates a person on happy path", async () => {
    requirePeopleCreateMock.mockResolvedValue({ user: { id: "user-1" } });
    createPersonMock.mockResolvedValue({ id: "person-1" });

    const { createPersonAction } = await import("@/lib/people/actions");

    const formData = new FormData();
    formData.set("nombres", "Persona");
    formData.set("apellidoPaterno", "Demo");
    formData.set("apellidoMaterno", "");
    formData.set("email", "persona.demo@ejemplo.local");
    formData.set("telefono", "");
    formData.set("fechaNacimiento", "");
    formData.set("fechaIngreso", "2024-01-15");
    formData.set("areaId", "");
    formData.set("positionId", "");
    formData.set("managerId", "");
    formData.set("rfc", "XAXX010101000");
    formData.set("curp", "");
    formData.set("nss", "");
    formData.set("status", "activa");

    await expect(createPersonAction({}, formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(createPersonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nombres: "Persona",
        apellidoPaterno: "Demo",
        rfc: "XAXX010101000",
        status: "activa",
      }),
      "user-1",
    );
  });
});
