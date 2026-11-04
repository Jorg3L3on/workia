import { describe, expect, it } from "vitest";

import { vacationEntitlementForPerson } from "@/lib/people/vacation-card";

import { serviceYearBalance } from "./balance";
import { composeVacationBalance } from "./summary";

const record = (
  id: string,
  serviceYear: number,
  startDate: string,
  days: string,
) => ({ id, serviceYear, startDate, endDate: startDate, days });

const base = {
  seniorityDate: "2023-03-01",
  status: "activa" as const,
  fechaBaja: null,
  today: "2026-11-04",
};

describe("composeVacationBalance", () => {
  it("gives the HR card's current balance and entitlement", () => {
    const records = [
      record("a", 3, "2026-06-10", "5.0"),
      record("b", 3, "2026-07-01", "0.5"),
      record("c", 2, "2025-06-01", "4.0"),
    ];
    const summary = composeVacationBalance({ ...base, records });
    const view = vacationEntitlementForPerson(base);

    expect(summary.view).toEqual(view);
    expect(summary.current).toEqual(
      serviceYearBalance({
        serviceYear: 3,
        entitlementDays: 16,
        entries: records.map((row) => ({ ...row, voided: false })),
      }),
    );
    expect(summary.current?.remainingHalves).toBe(21);
  });

  it("lists every service year, newest first, with its own entitlement", () => {
    const summary = composeVacationBalance({
      ...base,
      records: [
        record("a", 3, "2026-06-10", "5.0"),
        record("c", 2, "2025-06-01", "4.0"),
      ],
    });

    expect(
      summary.years.map((line) => [
        line.serviceYear,
        line.entitlementDays,
        line.takenHalves,
        line.remainingHalves,
        line.current,
        line.constancia,
      ]),
    ).toEqual([
      [3, 16, 10, 22, true, true],
      [2, 14, 8, 20, false, true],
      [1, 12, 0, 24, false, true],
    ]);
    expect(summary.years[1].anniversary).toBe("2025-03-01");
    expect(summary.years[1].grantBy).toBe("2025-09-01");
  });

  it("strips notes and authors and sorts ranges newest first", () => {
    // Rows as listVacationRecords returns them, with the HR-only fields.
    const rows = [
      { ...record("old", 2, "2025-06-01", "4.0"), note: "Consulta médica" },
      { ...record("new", 3, "2026-06-10", "5.0"), createdByName: "RH" },
    ];
    const summary = composeVacationBalance({ ...base, records: rows });

    expect(summary.records.map((row) => row.id)).toEqual(["new", "old"]);
    expect(Object.keys(summary.records[0]).sort()).toEqual([
      "days",
      "endDate",
      "id",
      "serviceYear",
      "startDate",
    ]);
  });

  it("has no balance before the first year, and still counts days taken", () => {
    const summary = composeVacationBalance({
      ...base,
      seniorityDate: "2026-03-01",
      records: [record("a", 0, "2026-06-10", "1.0")],
    });

    expect(summary.view.state).toBe("proportional");
    expect(summary.current).toBeNull();
    expect(summary.years).toEqual([
      expect.objectContaining({
        serviceYear: 0,
        entitlementDays: null,
        takenHalves: 2,
        remainingHalves: null,
        constancia: false,
      }),
    ]);
  });

  it("leaves out years completed before the reformed table unless they have days", () => {
    const summary = composeVacationBalance({
      ...base,
      seniorityDate: "2018-03-01",
      records: [record("a", 4, "2022-06-01", "3.0")],
    });

    expect(summary.current?.serviceYear).toBe(8);
    expect(summary.years.map((line) => line.serviceYear)).toEqual([
      8, 7, 6, 5, 4,
    ]);
    expect(summary.years.at(-1)).toEqual(
      expect.objectContaining({ entitlementDays: null, takenHalves: 6 }),
    );
  });

  it("counts to the fecha de baja", () => {
    const summary = composeVacationBalance({
      ...base,
      status: "baja",
      fechaBaja: "2025-05-01",
      records: [],
    });

    expect(summary.view.closed).toBe(true);
    expect(summary.current?.serviceYear).toBe(2);
  });

  it("holds days only: no money field anywhere in the summary", () => {
    const summary = composeVacationBalance({
      ...base,
      records: [record("a", 3, "2026-06-10", "5.0")],
    });
    const keys = JSON.stringify({ ...summary, view: undefined });

    expect(keys).not.toMatch(/pago|prima|monto|amount/i);
  });
});
