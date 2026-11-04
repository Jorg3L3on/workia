import { describe, expect, it } from "vitest";

import { PayPeriodError, quincenaOf, quincenaRange } from "./quincena";

describe("quincenas", () => {
  it("maps a day to its quincena", () => {
    expect(quincenaOf("2026-11-01")).toBe("2026-11-Q1");
    expect(quincenaOf("2026-11-15")).toBe("2026-11-Q1");
    expect(quincenaOf("2026-11-16")).toBe("2026-11-Q2");
    expect(quincenaOf("2026-12-31")).toBe("2026-12-Q2");
    expect(() => quincenaOf("2026-11-1")).toThrow(PayPeriodError);
  });

  it("maps a quincena to its days, both ends included", () => {
    expect(quincenaRange("2026-11-Q1")).toEqual({
      from: "2026-11-01",
      to: "2026-11-15",
    });
    expect(quincenaRange("2026-11-Q2")).toEqual({
      from: "2026-11-16",
      to: "2026-11-30",
    });
    expect(quincenaRange("2026-02-Q2").to).toBe("2026-02-28");
    expect(quincenaRange("2028-02-Q2").to).toBe("2028-02-29");
  });

  it("refuses anything but AAAA-MM-Q1 or AAAA-MM-Q2", () => {
    for (const period of ["2026-13-Q1", "2026-11-Q3", "2026-11", "x"]) {
      expect(() => quincenaRange(period)).toThrow(PayPeriodError);
    }
  });
});
