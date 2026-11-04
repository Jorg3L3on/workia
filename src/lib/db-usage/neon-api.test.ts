import { describe, expect, it, vi } from "vitest";

import { fetchNeonUsage, parseNeonUsage, readNeonApiConfig } from "./neon-api";

const project = {
  project: {
    compute_time_seconds: 90_000,
    active_time_seconds: 180_000,
    data_transfer_bytes: 1_200_000_000,
    consumption_period_start: "2026-11-01T00:00:00Z",
  },
};
const branches = {
  branches: [
    { id: "br-main", logical_size: 300_000_000 },
    { id: "br-drill", logical_size: 50_000_000 },
  ],
};

describe("parseNeonUsage", () => {
  it("converts CU-seconds to CU-hours and sums branch sizes", () => {
    expect(parseNeonUsage(project, branches)).toEqual({
      computeCuHours: 25,
      activeHours: 50,
      egressBytes: 1_200_000_000,
      storageBytes: 350_000_000,
      branches: 2,
      periodStart: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("tolerates missing fields", () => {
    expect(parseNeonUsage({}, null)).toMatchObject({
      computeCuHours: 0,
      storageBytes: 0,
      branches: 0,
      periodStart: null,
    });
  });
});

describe("readNeonApiConfig", () => {
  it("needs both the key and the project", () => {
    expect(readNeonApiConfig({ NEON_API_KEY: "k" })).toBeNull();
    expect(
      readNeonApiConfig({ NEON_API_KEY: " k ", NEON_PROJECT_ID: "p" }),
    ).toEqual({ apiKey: "k", projectId: "p" });
  });
});

describe("fetchNeonUsage", () => {
  it("reads the project and its branches with the key", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      Response.json(String(url).endsWith("/branches") ? branches : project),
    );

    const usage = await fetchNeonUsage(
      { apiKey: "secret", projectId: "proj-1" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(usage.computeCuHours).toBe(25);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/proj-1",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("fails on an error status", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("no", { status: 401 }),
    ) as unknown as typeof fetch;

    await expect(
      fetchNeonUsage({ apiKey: "bad", projectId: "p" }, fetchImpl),
    ).rejects.toThrow("401");
  });
});
