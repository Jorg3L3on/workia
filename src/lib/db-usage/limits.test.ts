import { describe, expect, it } from "vitest";

import {
  assessUsage,
  formatBytes,
  levelFor,
  NEON_FREE_LIMITS,
  worstLevel,
} from "./limits";

describe("levelFor", () => {
  it("warns from 80 % and turns critical from 95 %", () => {
    expect(levelFor(0.79)).toBe("ok");
    expect(levelFor(0.8)).toBe("warn");
    expect(levelFor(0.949)).toBe("warn");
    expect(levelFor(0.95)).toBe("critical");
    expect(levelFor(1.2)).toBe("critical");
  });
});

describe("worstLevel", () => {
  it("returns the most urgent level", () => {
    expect(worstLevel([])).toBe("ok");
    expect(worstLevel(["ok", "warn"])).toBe("warn");
    expect(worstLevel(["warn", "critical", "ok"])).toBe("critical");
  });
});

describe("formatBytes", () => {
  it("uses decimal units like Neon", () => {
    expect(formatBytes(1_000_000_000)).toBe("1 GB");
    expect(formatBytes(412_300_000)).toBe("412.3 MB");
    expect(formatBytes(2_500)).toBe("3 kB");
  });
});

describe("assessUsage", () => {
  it("shows only storage without the Neon API", () => {
    const metrics = assessUsage({
      storageBytes: 850_000_000,
      computeCuHours: null,
      egressBytes: null,
      branches: null,
    });

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      key: "storage",
      level: "warn",
      ratio: 0.85,
      summary: "850 MB de 1 GB",
    });
  });

  it("compares compute, egress and branches with the Free limits", () => {
    const metrics = assessUsage({
      storageBytes: 100_000_000,
      computeCuHours: 97,
      egressBytes: 1_000_000_000,
      branches: 3,
    });
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));

    expect(byKey.compute.level).toBe("critical");
    expect(byKey.compute.limit).toBe(NEON_FREE_LIMITS.computeCuHours);
    expect(byKey.egress.level).toBe("ok");
    expect(byKey.branches.summary).toBe("3 de 10");
  });
});
