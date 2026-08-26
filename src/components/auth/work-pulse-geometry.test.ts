import { describe, expect, it } from "vitest";

import {
  dayToPulseX,
  daysInCalendarMonth,
  formatPayrollDateLabel,
} from "./work-pulse-geometry";

describe("work-pulse-geometry", () => {
  it("maps payroll days to the pulse line", () => {
    expect(dayToPulseX(1, 31)).toBe(4);
    expect(dayToPulseX(31, 31)).toBe(296);
    expect(dayToPulseX(16, 31)).toBeCloseTo(150, 0);
  });

  it("returns calendar days in a month", () => {
    expect(daysInCalendarMonth(2026, 2)).toBe(28);
    expect(daysInCalendarMonth(2026, 8)).toBe(31);
  });

  it("formats the payroll date in Spanish", () => {
    expect(formatPayrollDateLabel(new Date(2026, 7, 26))).toMatch(/26 ago/i);
  });
});
