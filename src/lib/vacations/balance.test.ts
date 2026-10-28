import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { vacationRecords } from "@/lib/db/schema";

import {
  VACATION_OVER_ENTITLEMENT_WARNING,
  formatStoredDays,
  formatVacationDays,
  previewVacationRegistration,
  serviceYearBalance,
  toHalfUnits,
} from "./balance";
import type { VacationPeriodSlice, VacationSpan } from "./types";

const period = (
  id: string,
  fechaIngreso: string,
  fechaBaja: string | null = null,
): VacationPeriodSlice => ({
  id,
  fechaIngreso,
  fechaBaja,
  bajaSinFecha: false,
  reconoceAntiguedad: false,
  fechaAntiguedadReconocida: null,
});

const span = (
  startDate: string,
  endDate: string,
  days: string,
  serviceYear: number,
  voided = false,
): VacationSpan => ({
  startDate,
  endDate,
  days,
  serviceYear,
  voided,
});

const base = {
  periods: [period("p1", "2023-03-01")],
  fallbackFechaIngreso: "2023-03-01",
  existing: [] as VacationSpan[],
};

describe("serviceYearBalance", () => {
  it("subtracts the days taken in that service year", () => {
    const balance = serviceYearBalance({
      serviceYear: 3,
      entitlementDays: 16,
      entries: [
        { serviceYear: 3, days: "5.0", voided: false },
        { serviceYear: 2, days: "4.0", voided: false },
        { serviceYear: 3, days: "2.0", voided: true },
      ],
    });

    expect(balance.takenHalves).toBe(10);
    expect(balance.remainingHalves).toBe(22);
    expect(balance.remainingHalves / 2).toBe(11);
    expect(balance.exceedsEntitlement).toBe(false);
  });

  it("counts a half day and flags a balance above the entitlement", () => {
    const balance = serviceYearBalance({
      serviceYear: 1,
      entitlementDays: 12,
      entries: [
        { serviceYear: 1, days: "11.5", voided: false },
        { serviceYear: 1, days: "0.5", voided: false },
      ],
    });

    expect(balance.takenHalves).toBe(24);
    expect(balance.remainingHalves).toBe(0);
    expect(
      serviceYearBalance({
        serviceYear: 1,
        entitlementDays: 12,
        entries: [{ serviceYear: 1, days: "12.5", voided: false }],
      }).exceedsEntitlement,
    ).toBe(true);
  });
});

describe("toHalfUnits", () => {
  it("accepts half-day steps and rejects the rest", () => {
    expect(toHalfUnits("0.5")).toBe(1);
    expect(toHalfUnits("0,5")).toBe(1);
    expect(toHalfUnits("1")).toBe(2);
    expect(toHalfUnits("1.0")).toBe(2);
    expect(toHalfUnits("5.5")).toBe(11);
    expect(toHalfUnits("0")).toBeNull();
    expect(toHalfUnits("0.0")).toBeNull();
    expect(toHalfUnits("1.2")).toBeNull();
    expect(toHalfUnits("1.25")).toBeNull();
    expect(toHalfUnits("-1")).toBeNull();
    expect(toHalfUnits("1000")).toBeNull();
    expect(formatStoredDays(11)).toBe("5.5");
    expect(formatVacationDays("1.0")).toBe("1 día");
    expect(formatVacationDays("0.5")).toBe("0,5 días");
    expect(formatVacationDays("5")).toBe("5 días");
  });
});

describe("previewVacationRegistration", () => {
  it("places five typed days in service year 3 and leaves eleven", () => {
    const preview = previewVacationRegistration({
      ...base,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
      days: "5",
    });

    expect(preview).toMatchObject({
      ok: true,
      serviceYear: 3,
      days: "5.0",
      periodId: "p1",
      warning: null,
    });

    if (!preview.ok) {
      return;
    }

    const balance = serviceYearBalance({
      serviceYear: preview.serviceYear,
      entitlementDays: 16,
      entries: [{ serviceYear: 3, days: preview.days, voided: false }],
    });

    expect(balance.remainingHalves / 2).toBe(11);
  });

  it("keeps the typed amount when the calendar span is a single day", () => {
    const preview = previewVacationRegistration({
      ...base,
      startDate: "2026-06-10",
      endDate: "2026-06-10",
      days: "5",
    });

    expect(preview).toMatchObject({ ok: true, days: "5.0", warning: null });
  });

  it("warns above the entitlement and still accepts the row", () => {
    const preview = previewVacationRegistration({
      ...base,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      days: "20",
      existing: [span("2026-06-10", "2026-06-14", "5.0", 3)],
    });

    expect(preview).toMatchObject({
      ok: true,
      warning: VACATION_OVER_ENTITLEMENT_WARNING,
    });
  });

  it("rejects overlap, zero days and an end before the start", () => {
    expect(
      previewVacationRegistration({
        ...base,
        startDate: "2026-06-14",
        endDate: "2026-06-16",
        days: "1",
        existing: [span("2026-06-10", "2026-06-14", "5.0", 3)],
      }),
    ).toEqual({ ok: false, error: expect.stringMatching(/cruzan/) });

    expect(
      previewVacationRegistration({
        ...base,
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        days: "1",
        existing: [span("2026-06-10", "2026-06-14", "5.0", 3)],
      }).ok,
    ).toBe(true);

    expect(
      previewVacationRegistration({
        ...base,
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        days: "1",
        existing: [span("2026-06-10", "2026-06-14", "5.0", 3, true)],
      }).ok,
    ).toBe(true);

    expect(
      previewVacationRegistration({
        ...base,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        days: "0",
      }).ok,
    ).toBe(false);

    expect(
      previewVacationRegistration({
        ...base,
        startDate: "2026-07-03",
        endDate: "2026-07-01",
        days: "1",
      }).ok,
    ).toBe(false);
  });

  it("uses the period that contains the start date", () => {
    const preview = previewVacationRegistration({
      periods: [
        period("old", "2020-01-01", "2022-12-31"),
        period("current", "2023-03-01"),
      ],
      fallbackFechaIngreso: null,
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      days: "2",
      existing: [],
    });

    expect(preview).toMatchObject({ ok: true, periodId: "current" });
  });
});

describe("vacation ledger rules", () => {
  it("marks the accountant-pending choices and does not delete rows", () => {
    const rules = readFileSync(
      join(process.cwd(), "src/lib/vacations/balance.ts"),
      "utf8",
    );
    const domain = readFileSync(
      join(process.cwd(), "src/lib/vacations/index.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(process.cwd(), "drizzle/0029_vacation_records.sql"),
      "utf8",
    );

    expect(
      rules.match(/pendiente de contador/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(domain).not.toMatch(/\.delete\(/);
    expect(migration).toContain("vacation_records_company_isolation");
    expect(migration).toContain("vacation_records_company_person_start_idx");
    expect(migration).toContain("numeric(4, 1)");
    expect(migration).not.toMatch(/^DROP TABLE/m);
    expect(migration).not.toMatch(/^DELETE FROM/m);
  });

  it("stores the columns the ledger needs and nothing that pays instead of resting", () => {
    const names = getTableConfig(vacationRecords).columns.map(
      (column) => column.name,
    );

    expect(names).toEqual([
      "id",
      "company_id",
      "person_id",
      "employment_period_id",
      "service_year",
      "start_date",
      "end_date",
      "days",
      "note",
      "created_by",
      "created_at",
      "voided_at",
    ]);
    expect(names.join(" ")).not.toMatch(/pago|prima|monto/);
    expect(
      getTableConfig(vacationRecords).columns.find(
        (column) => column.name === "company_id",
      )?.notNull,
    ).toBe(true);
  });
});
