import { describe, expect, it } from "vitest";

import {
  formatDateMx,
  formatDateTimeMx,
  formatStoredDateValue,
  isoToday,
  parseFlexibleDateToIso,
} from "@/lib/format/date";

describe("formatDateMx", () => {
  it("formats stored calendar dates as dd/mm/yyyy", () => {
    expect(formatDateMx("2026-03-15")).toBe("15/03/2026");
    expect(formatDateMx("2026-01-02")).toBe("02/01/2026");
  });

  it("does not follow the en-US mm/dd default", () => {
    const ambiguous = new Date("2026-03-15T12:00:00");
    const enUs = new Intl.DateTimeFormat("en-US").format(ambiguous);

    expect(enUs).toMatch(/^3\/15\/2026/);
    expect(formatDateMx("2026-03-15")).toBe("15/03/2026");
    expect(formatDateMx("2026-03-15")).not.toBe(enUs);
  });

  it("returns an em dash for empty or invalid values", () => {
    expect(formatDateMx(null)).toBe("—");
    expect(formatDateMx("")).toBe("—");
    expect(formatDateMx("no-es-fecha")).toBe("—");
  });
});

describe("formatDateTimeMx", () => {
  it("keeps day before month on timestamps", () => {
    const label = formatDateTimeMx("2026-03-15T18:30:00.000Z");

    expect(label).toMatch(/^15\/03\/2026, \d{2}:\d{2}$/);
    expect(label).not.toMatch(/^03\/15\//);
  });
});

describe("parseFlexibleDateToIso", () => {
  it("reads México and ISO order without swapping month and day", () => {
    expect(parseFlexibleDateToIso("15/03/2026")).toBe("2026-03-15");
    expect(parseFlexibleDateToIso("15-03-2026")).toBe("2026-03-15");
    expect(parseFlexibleDateToIso("2026-03-15")).toBe("2026-03-15");
    expect(parseFlexibleDateToIso("32/13/2026")).toBeNull();
  });
});

describe("formatStoredDateValue", () => {
  it("formats ISO calendar dates and leaves other strings alone", () => {
    expect(formatStoredDateValue("2026-03-15")).toBe("15/03/2026");
    expect(formatStoredDateValue("XAXX010101000")).toBeNull();
  });
});

describe("isoToday", () => {
  it("returns a yyyy-mm-dd calendar date", () => {
    expect(isoToday(new Date("2026-03-15T18:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
