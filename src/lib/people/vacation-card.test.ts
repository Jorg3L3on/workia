import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seniorityAsOf } from "@/components/people/person-detail-model";
import { vacationPeriodFor } from "@/lib/people/vacation";
import {
  VACATION_CARD_COPY,
  VACATION_PRIMA_TEXT,
  vacationAsOf,
  vacationEntitlementForPerson,
  vacationEntitlementView,
  vacationToolFields,
} from "@/lib/people/vacation-card";

describe("vacationEntitlementView", () => {
  it("shows the completed service year, both anniversaries, the days and grantBy", () => {
    const view = vacationEntitlementView({
      seniorityDate: "2023-03-01",
      asOf: "2026-03-02",
      closed: false,
    });

    expect(view).toEqual({
      state: "entitled",
      message: null,
      serviceYearsCompleted: 3,
      currentAnniversary: "2026-03-01",
      nextAnniversary: "2027-03-01",
      entitlementDays: 16,
      grantBy: "2026-09-01",
      prima: VACATION_PRIMA_TEXT,
      closed: false,
      asOf: "2026-03-02",
    });
    expect(view.prima).toBe("Prima vacacional: no menor al 25% (Art. 80 LFT)");
  });

  it("hides grantBy when the person has less than one year of service", () => {
    const engine = vacationPeriodFor("2025-06-15", "2026-06-14");
    const view = vacationEntitlementView({
      seniorityDate: "2025-06-15",
      asOf: "2026-06-14",
      closed: false,
    });

    expect(engine?.proportionalOnly).toBe(true);
    expect(engine?.grantBy).toBe("2025-12-15");
    expect(view).toMatchObject({
      state: "proportional",
      message: VACATION_CARD_COPY.notYet,
      serviceYearsCompleted: 0,
      currentAnniversary: "2025-06-15",
      nextAnniversary: "2026-06-15",
      entitlementDays: null,
      grantBy: null,
      prima: null,
      closed: false,
    });
  });

  it("says there is no hire date, and does not invent a period", () => {
    expect(
      vacationEntitlementView({
        seniorityDate: null,
        asOf: "2026-03-02",
        closed: false,
      }),
    ).toMatchObject({
      state: "no_hire_date",
      message: "Sin fecha de ingreso",
      entitlementDays: null,
      grantBy: null,
      prima: null,
    });
  });

  it("stays neutral when the reformed table is not in force yet", () => {
    const view = vacationEntitlementView({
      seniorityDate: "2020-03-01",
      asOf: "2022-12-31",
      closed: false,
    });

    expect(vacationPeriodFor("2020-03-01", "2022-12-31")).toBeNull();
    expect(view).toMatchObject({
      state: "before_table",
      message: "Sin cálculo para esta fecha",
      serviceYearsCompleted: null,
      entitlementDays: null,
      grantBy: null,
      prima: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/14|pendiente|contable/);
  });

  it("marks a baja as a closed period and still shows the entitlement at the baja", () => {
    const view = vacationEntitlementForPerson({
      seniorityDate: "2023-03-01",
      status: "baja",
      fechaBaja: "2026-03-02",
      today: "2026-10-28",
    });

    expect(view).toMatchObject({
      state: "entitled",
      message: "Periodo cerrado",
      serviceYearsCompleted: 3,
      entitlementDays: 16,
      grantBy: "2026-09-01",
      prima: VACATION_PRIMA_TEXT,
      closed: true,
      asOf: "2026-03-02",
    });
  });

  it("on a baja before one year, hides grantBy and says vacations are not due yet", () => {
    const view = vacationEntitlementForPerson({
      seniorityDate: "2025-06-15",
      status: "baja",
      fechaBaja: "2026-01-10",
      today: "2026-10-28",
    });

    expect(view).toMatchObject({
      state: "proportional",
      message: "Periodo cerrado · Aún no genera vacaciones",
      grantBy: null,
      entitlementDays: null,
      prima: null,
      closed: true,
      asOf: "2026-01-10",
    });
  });

  it("does not count a baja that has no date", () => {
    const view = vacationEntitlementForPerson({
      seniorityDate: "2023-03-01",
      status: "baja",
      fechaBaja: null,
      today: "2026-10-28",
    });

    expect(view).toMatchObject({
      state: "closed",
      message: "Periodo cerrado",
      serviceYearsCompleted: null,
      grantBy: null,
      entitlementDays: null,
      prima: null,
      asOf: null,
    });
  });

  it("reports an error instead of guessing when the dates cannot be calculated", () => {
    expect(
      vacationEntitlementView({
        seniorityDate: "2026-04-01",
        asOf: "2026-03-02",
        closed: false,
      }),
    ).toMatchObject({
      state: "error",
      message: VACATION_CARD_COPY.error,
      entitlementDays: null,
      grantBy: null,
    });
  });

  it("counts an active person to the today the server passed in", () => {
    expect(
      vacationAsOf({ status: "activa", fechaBaja: null, today: "2026-10-28" }),
    ).toBe("2026-10-28");
    expect(
      vacationEntitlementForPerson({
        seniorityDate: "2023-03-01",
        status: "activa",
        fechaBaja: null,
        today: "2026-10-28",
      }).asOf,
    ).toBe("2026-10-28");
  });

  it("uses the same as-of day as the seniority strip", () => {
    const cases = [
      { status: "activa" as const, fechaBaja: null, today: "2026-10-28" },
      { status: "baja" as const, fechaBaja: "2024-05-01", today: "2026-10-28" },
      { status: "baja" as const, fechaBaja: "2027-01-01", today: "2026-10-28" },
      { status: "baja" as const, fechaBaja: null, today: "2026-10-28" },
    ];

    for (const input of cases) {
      expect(vacationAsOf(input)).toBe(seniorityAsOf(input));
    }
  });

  it("gives the tool the same fields the card renders, with no note", () => {
    const view = vacationEntitlementView({
      seniorityDate: "2023-03-01",
      asOf: "2026-03-02",
      closed: false,
    });
    const fields = vacationToolFields(view);

    expect(fields).toEqual({
      state: "entitled",
      message: null,
      service_years_completed: 3,
      current_anniversary: "2026-03-01",
      current_anniversary_mx: "01/03/2026",
      next_anniversary: "2027-03-01",
      next_anniversary_mx: "01/03/2027",
      entitlement_days: 16,
      grant_by: "2026-09-01",
      grant_by_mx: "01/09/2026",
      prima_vacacional: VACATION_PRIMA_TEXT,
      closed: false,
      as_of: "2026-03-02",
      as_of_mx: "02/03/2026",
    });
    expect(Object.keys(fields)).not.toContain("notes");
    expect(Object.keys(fields)).not.toContain("text");
  });

  it("does not read the clock", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/people/vacation-card.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/new Date\(|isoToday\(/);
  });
});
