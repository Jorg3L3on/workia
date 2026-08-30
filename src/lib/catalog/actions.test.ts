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
  requireActivitiesCreateMock,
  requireActivitiesUpdateMock,
  requireActivitiesDeleteMock,
  requirePositionsUpdateMock,
  createActivityMock,
  updateActivityMock,
  softDeleteActivityMock,
  assignActivityToPositionMock,
  unassignActivityFromPositionMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireActivitiesCreateMock: vi.fn(),
  requireActivitiesUpdateMock: vi.fn(),
  requireActivitiesDeleteMock: vi.fn(),
  requirePositionsUpdateMock: vi.fn(),
  createActivityMock: vi.fn(),
  updateActivityMock: vi.fn(),
  softDeleteActivityMock: vi.fn(),
  assignActivityToPositionMock: vi.fn(),
  unassignActivityFromPositionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/catalog/auth", () => ({
  requireAreasCreate: vi.fn(),
  requireAreasDelete: vi.fn(),
  requirePositionsCreate: vi.fn(),
  requirePositionsDelete: vi.fn(),
  requireActivitiesCreate: requireActivitiesCreateMock,
  requireActivitiesUpdate: requireActivitiesUpdateMock,
  requireActivitiesDelete: requireActivitiesDeleteMock,
  requirePositionsUpdate: requirePositionsUpdateMock,
}));

vi.mock("@/lib/catalog", () => ({
  createArea: vi.fn(),
  createPosition: vi.fn(),
  softDeleteArea: vi.fn(),
  softDeletePosition: vi.fn(),
  createActivity: createActivityMock,
  updateActivity: updateActivityMock,
  softDeleteActivity: softDeleteActivityMock,
  assignActivityToPosition: assignActivityToPositionMock,
  unassignActivityFromPosition: unassignActivityFromPositionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const POSITION_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";

describe("createActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when create permission is missing", async () => {
    requireActivitiesCreateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: positions:create"),
    );

    const { createActivityAction } = await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("name", "Actividad dummy");
    formData.set("active", "true");

    await expect(createActivityAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining("error=activities-create"),
    );
  });

  it("creates an activity on the happy path", async () => {
    requireActivitiesCreateMock.mockResolvedValue({ user: { id: "user-1" } });
    createActivityMock.mockResolvedValue({ id: ACTIVITY_ID });

    const { createActivityAction } = await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("name", "Captura de reportes semanales");
    formData.set("active", "true");

    await expect(createActivityAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      { name: "Captura de reportes semanales", active: true },
      "user-1",
    );
  });
});

describe("updateActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when update permission is missing", async () => {
    requireActivitiesUpdateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: positions:update"),
    );

    const { updateActivityAction } = await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("name", "Actividad dummy");
    formData.set("active", "false");

    await expect(updateActivityAction(ACTIVITY_ID, formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(updateActivityMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining("error=activities-update"),
    );
  });
});

describe("deleteActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when delete permission is missing", async () => {
    requireActivitiesDeleteMock.mockRejectedValue(
      new AuthorizationError("Missing permission: positions:delete"),
    );

    const { deleteActivityAction } = await import("@/lib/catalog/actions");

    await expect(deleteActivityAction(ACTIVITY_ID)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(softDeleteActivityMock).not.toHaveBeenCalled();
  });
});

describe("assignActivityToPositionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when update permission is missing", async () => {
    requirePositionsUpdateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: positions:update"),
    );

    const { assignActivityToPositionAction } =
      await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("positionId", POSITION_ID);
    formData.set("activityId", ACTIVITY_ID);

    await expect(assignActivityToPositionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(assignActivityToPositionMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining("error=positions-update"),
    );
  });

  it("assigns an activity on the happy path", async () => {
    requirePositionsUpdateMock.mockResolvedValue({ user: { id: "user-1" } });
    assignActivityToPositionMock.mockResolvedValue({
      ok: true,
      created: true,
    });

    const { assignActivityToPositionAction } =
      await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("positionId", POSITION_ID);
    formData.set("activityId", ACTIVITY_ID);

    await expect(assignActivityToPositionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(assignActivityToPositionMock).toHaveBeenCalledWith(
      POSITION_ID,
      ACTIVITY_ID,
      "user-1",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining("assigned=activity"),
    );
  });
});

describe("unassignActivityFromPositionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("fails closed when update permission is missing", async () => {
    requirePositionsUpdateMock.mockRejectedValue(
      new AuthorizationError("Missing permission: positions:update"),
    );

    const { unassignActivityFromPositionAction } =
      await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("positionId", POSITION_ID);
    formData.set("activityId", ACTIVITY_ID);

    await expect(unassignActivityFromPositionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(unassignActivityFromPositionMock).not.toHaveBeenCalled();
  });

  it("unassigns an activity on the happy path", async () => {
    requirePositionsUpdateMock.mockResolvedValue({ user: { id: "user-1" } });
    unassignActivityFromPositionMock.mockResolvedValue({
      ok: true,
      removed: true,
    });

    const { unassignActivityFromPositionAction } =
      await import("@/lib/catalog/actions");

    const formData = new FormData();
    formData.set("positionId", POSITION_ID);
    formData.set("activityId", ACTIVITY_ID);

    await expect(unassignActivityFromPositionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(unassignActivityFromPositionMock).toHaveBeenCalledWith(
      POSITION_ID,
      ACTIVITY_ID,
      "user-1",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining("unassigned=activity"),
    );
  });
});
