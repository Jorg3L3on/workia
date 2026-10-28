import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seniorityParts } from "@/lib/people/seniority";
import {
  VACATION_TABLE_EFFECTIVE_FROM,
  entitlementDaysForServiceYear,
  vacationPeriodFor,
} from "@/lib/people/vacation";

describe("entitlementDaysForServiceYear", () => {
  it.each([
    [1, 12],
    [2, 14],
    [3, 16],
    [4, 18],
    [5, 20],
    [6, 22],
    [7, 22],
    [8, 22],
    [9, 22],
    [10, 22],
    [11, 24],
  ])(
    "service year %i entitles %i days (decree table, boundaries 5/6 and 10/11)",
    (serviceYear, days) => {
      expect(entitlementDaysForServiceYear(serviceYear)).toBe(days);
    },
  );

  it("follows the PROFEDET blocks and keeps adding two days every five years after year 30", () => {
    expect(entitlementDaysForServiceYear(15)).toBe(24);
    expect(entitlementDaysForServiceYear(16)).toBe(26);
    expect(entitlementDaysForServiceYear(20)).toBe(26);
    expect(entitlementDaysForServiceYear(21)).toBe(28);
    expect(entitlementDaysForServiceYear(25)).toBe(28);
    expect(entitlementDaysForServiceYear(26)).toBe(30);
    expect(entitlementDaysForServiceYear(30)).toBe(30);
    expect(entitlementDaysForServiceYear(31)).toBe(32);
    expect(entitlementDaysForServiceYear(35)).toBe(32);
    expect(entitlementDaysForServiceYear(36)).toBe(34);
  });

  it("is zero before the first completed year", () => {
    expect(entitlementDaysForServiceYear(0)).toBe(0);
    expect(entitlementDaysForServiceYear(-1)).toBe(0);
  });
});

describe("vacationPeriodFor", () => {
  const seniority = "2023-03-01";

  it("counts a different service year the day after the anniversary and the day before", () => {
    expect(vacationPeriodFor(seniority, "2026-03-02")).toEqual({
      serviceYearsCompleted: 3,
      currentAnniversary: "2026-03-01",
      nextAnniversary: "2027-03-01",
      entitlementDays: 16,
      grantBy: "2026-09-01",
      proportionalOnly: false,
    });
    expect(vacationPeriodFor(seniority, "2026-02-28")).toEqual({
      serviceYearsCompleted: 2,
      currentAnniversary: "2025-03-01",
      nextAnniversary: "2026-03-01",
      entitlementDays: 14,
      grantBy: "2025-09-01",
      proportionalOnly: false,
    });
  });

  it("counts the anniversary day itself as the new service year", () => {
    expect(vacationPeriodFor(seniority, "2026-03-01")).toMatchObject({
      serviceYearsCompleted: 3,
      currentAnniversary: "2026-03-01",
      entitlementDays: 16,
      grantBy: "2026-09-01",
      proportionalOnly: false,
    });
  });

  it("moves 29 February to 1 March when that anniversary is not a leap day", () => {
    const leap = "2024-02-29";

    expect(vacationPeriodFor(leap, "2025-02-28")).toEqual({
      serviceYearsCompleted: 0,
      currentAnniversary: "2024-02-29",
      nextAnniversary: "2025-03-01",
      entitlementDays: 0,
      grantBy: "2024-08-29",
      proportionalOnly: true,
    });
    expect(vacationPeriodFor(leap, "2025-03-01")).toEqual({
      serviceYearsCompleted: 1,
      currentAnniversary: "2025-03-01",
      nextAnniversary: "2026-03-01",
      entitlementDays: 12,
      grantBy: "2025-09-01",
      proportionalOnly: false,
    });
    expect(vacationPeriodFor(leap, "2028-02-29")).toEqual({
      serviceYearsCompleted: 4,
      currentAnniversary: "2028-02-29",
      nextAnniversary: "2029-03-01",
      entitlementDays: 18,
      grantBy: "2028-08-29",
      proportionalOnly: false,
    });
  });

  it("does not apply the reformed table before it is in force", () => {
    expect(VACATION_TABLE_EFFECTIVE_FROM).toBe("2023-01-01");
    expect(vacationPeriodFor("2020-03-01", "2022-12-31")).toBeNull();
    expect(vacationPeriodFor("2020-03-01", "2023-01-01")).toMatchObject({
      serviceYearsCompleted: 2,
      currentAnniversary: "2022-03-01",
      entitlementDays: 14,
      proportionalOnly: false,
    });
  });

  it("returns null without a seniority date, before it, or on a day that does not exist", () => {
    expect(vacationPeriodFor(null, "2026-03-02")).toBeNull();
    expect(vacationPeriodFor(undefined, "2026-03-02")).toBeNull();
    expect(vacationPeriodFor("2026-04-01", "2026-03-02")).toBeNull();
    expect(vacationPeriodFor("2023-02-31", "2026-03-02")).toBeNull();
    expect(vacationPeriodFor(seniority, "2026-13-01")).toBeNull();
  });

  it("flags less than one year as proportional only, with no days yet", () => {
    expect(vacationPeriodFor("2025-06-15", "2026-06-14")).toEqual({
      serviceYearsCompleted: 0,
      currentAnniversary: "2025-06-15",
      nextAnniversary: "2026-06-15",
      entitlementDays: 0,
      grantBy: "2025-12-15",
      proportionalOnly: true,
    });
  });

  it("clamps the grant-by date to the last day of the month", () => {
    expect(vacationPeriodFor("2019-08-31", "2023-08-31")).toMatchObject({
      serviceYearsCompleted: 4,
      currentAnniversary: "2023-08-31",
      grantBy: "2024-02-29",
      entitlementDays: 18,
    });
    expect(vacationPeriodFor("2019-08-31", "2024-08-31")).toMatchObject({
      grantBy: "2025-02-28",
    });
  });

  it("opens and closes the service year on the same days seniorityParts does", () => {
    const period = vacationPeriodFor("2020-02-29", "2024-02-29");

    expect(period).not.toBeNull();
    expect(
      seniorityParts("2020-02-29", period!.currentAnniversary)?.years,
    ).toBe(period!.serviceYearsCompleted);
    expect(seniorityParts("2020-02-29", period!.nextAnniversary)?.years).toBe(
      period!.serviceYearsCompleted + 1,
    );
  });

  it("uses the completed years from seniorityParts for an ordinary anniversary", () => {
    const asOf = "2026-03-02";
    const period = vacationPeriodFor(seniority, asOf);

    expect(period?.serviceYearsCompleted).toBe(
      seniorityParts(seniority, asOf)?.years,
    );
  });

  it("defaults the accrual basis to anniversary", () => {
    expect(vacationPeriodFor(seniority, "2026-03-02", "anniversary")).toEqual(
      vacationPeriodFor(seniority, "2026-03-02"),
    );
  });

  it("returns only the entitlement fields, with no free-text note", () => {
    const period = vacationPeriodFor(seniority, "2026-03-02");

    expect(period).not.toBeNull();
    expect(Object.keys(period!).sort()).toEqual([
      "currentAnniversary",
      "entitlementDays",
      "grantBy",
      "nextAnniversary",
      "proportionalOnly",
      "serviceYearsCompleted",
    ]);
  });

  it("does not read the clock or the database", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/people/vacation.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/prisma|@\/lib\/db|node:fs|node:net/);
  });
});
