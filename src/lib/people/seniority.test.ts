import { describe, expect, it } from "vitest";

import { formatSeniority, seniorityParts } from "@/lib/people/seniority";

describe("seniority", () => {
  it("counts whole years and months up to the date", () => {
    expect(seniorityParts("2023-03-15", "2026-05-14")).toEqual({
      years: 3,
      months: 1,
    });
    expect(seniorityParts("2023-03-15", "2026-05-15")).toEqual({
      years: 3,
      months: 2,
    });
  });

  it("writes it in Spanish", () => {
    expect(formatSeniority("2023-03-15", "2026-05-15")).toBe("3 años, 2 meses");
    expect(formatSeniority("2025-05-15", "2026-05-15")).toBe("1 año");
    expect(formatSeniority("2026-04-01", "2026-05-15")).toBe("1 mes");
    expect(formatSeniority("2026-05-01", "2026-05-15")).toBe("menos de un mes");
  });

  it("is null without a hire date or before it", () => {
    expect(formatSeniority(null, "2026-05-15")).toBeNull();
    expect(formatSeniority("2026-06-01", "2026-05-15")).toBeNull();
  });
});
