import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatDateMx } from "@/lib/format/date";
import {
  entitlementDaysForServiceYear,
  vacationPeriodFor,
} from "@/lib/people/vacation";
import { formatSignedVacationDays } from "@/lib/vacations/balance";
import { composeVacationConstancia } from "@/lib/vacations/constancia-sheet";
import type { VacationSpan } from "@/lib/vacations/types";

const seniority = "2023-03-01";
const asOf = "2026-03-02";

const span = (
  partial: Partial<VacationSpan> & Pick<VacationSpan, "days" | "serviceYear">,
): VacationSpan => ({
  startDate: "2026-06-10",
  endDate: "2026-06-14",
  voided: false,
  ...partial,
});

describe("composeVacationConstancia", () => {
  it("fills the sheet from the engine and the non-voided rows of that year", () => {
    const period = vacationPeriodFor(seniority, asOf);
    const sheet = composeVacationConstancia({
      companyName: "Empresa Demostración SA",
      personName: "Ana Demostración",
      seniorityDate: seniority,
      serviceYear: 3,
      asOf,
      issuedOn: asOf,
      entries: [
        span({ days: "5", serviceYear: 3 }),
        span({
          days: "1",
          serviceYear: 3,
          startDate: "2026-07-01",
          endDate: "2026-07-01",
          voided: true,
        }),
        span({
          days: "2",
          serviceYear: 2,
          startDate: "2025-06-01",
          endDate: "2025-06-02",
        }),
      ],
    });

    expect(period).not.toBeNull();
    expect(sheet).toEqual({
      companyName: "Empresa Demostración SA",
      personName: "Ana Demostración",
      seniorityDate: seniority,
      serviceYear: 3,
      entitlementDays: period!.entitlementDays,
      takenHalves: 10,
      grantBy: period!.grantBy,
      issuedOn: asOf,
      ranges: [{ startDate: "2026-06-10", endDate: "2026-06-14", days: "5" }],
    });
    expect(sheet?.takenHalves).toBe(10);
    expect(formatSignedVacationDays(sheet!.takenHalves)).toBe("5 días");
    expect(formatDateMx(sheet!.grantBy)).toBe("01/09/2026");
  });

  it("counts zero days taken when the year has no live rows", () => {
    const sheet = composeVacationConstancia({
      companyName: "  ",
      personName: "Ana Demostración",
      seniorityDate: seniority,
      serviceYear: 3,
      asOf,
      issuedOn: asOf,
      entries: [],
    });

    expect(sheet?.companyName).toBe("La empresa");
    expect(sheet?.takenHalves).toBe(0);
    expect(sheet?.ranges).toEqual([]);
  });

  it("refuses a year that is not complete yet", () => {
    expect(
      composeVacationConstancia({
        companyName: "Empresa Demostración SA",
        personName: "Ana Demostración",
        seniorityDate: seniority,
        serviceYear: 4,
        asOf,
        issuedOn: asOf,
        entries: [],
      }),
    ).toBeNull();
    expect(
      composeVacationConstancia({
        companyName: "Empresa Demostración SA",
        personName: "Ana Demostración",
        seniorityDate: "2025-06-15",
        serviceYear: 1,
        asOf: "2026-06-14",
        issuedOn: "2026-06-14",
        entries: [],
      }),
    ).toBeNull();
  });

  it("prints today when the cutoff is an earlier fecha de baja", () => {
    const fechaBaja = "2025-06-01";
    const issuedOn = "2026-10-28";
    const closed = vacationPeriodFor(seniority, fechaBaja);
    const sheet = composeVacationConstancia({
      companyName: "Empresa Demostración SA",
      personName: "Persona Baja Demostración",
      seniorityDate: seniority,
      serviceYear: 2,
      asOf: fechaBaja,
      issuedOn,
      entries: [
        span({
          days: "3",
          serviceYear: 2,
          startDate: "2025-04-01",
          endDate: "2025-04-03",
        }),
        span({ days: "5", serviceYear: 3 }),
      ],
    });

    expect(closed?.serviceYearsCompleted).toBe(2);
    expect(closed?.entitlementDays).toBe(14);
    expect(sheet).toMatchObject({
      serviceYear: 2,
      entitlementDays: 14,
      takenHalves: 6,
      issuedOn,
      ranges: [{ startDate: "2025-04-01", endDate: "2025-04-03", days: "3" }],
    });
    expect(sheet?.issuedOn).not.toBe(fechaBaja);
    expect(
      composeVacationConstancia({
        companyName: "Empresa Demostración SA",
        personName: "Persona Baja Demostración",
        seniorityDate: seniority,
        serviceYear: 3,
        asOf: fechaBaja,
        issuedOn,
        entries: [],
      }),
    ).toBeNull();
  });

  it("uses the engine's year-6 count without adding a second table", () => {
    const sheet = composeVacationConstancia({
      companyName: "Empresa Demostración SA",
      personName: "Ana Demostración",
      seniorityDate: "2018-03-01",
      serviceYear: 6,
      asOf: "2024-03-01",
      issuedOn: "2024-03-01",
      entries: [],
    });

    expect(sheet?.entitlementDays).toBe(entitlementDaysForServiceYear(6));
  });
});

describe("vacation constancia print sheet", () => {
  it("hides the shell on paper and sizes the page to A4", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const printStart = css.indexOf("@media print");
    const print = css.slice(printStart);

    expect(printStart).toBeGreaterThan(0);
    expect(print).toContain("size: A4 portrait");
    expect(print).toContain('[data-slot="sidebar"]');
    expect(print).toContain('[data-slot="shell-top-nav"]');
    expect(print).toContain("[data-print-hide]");
    expect(print).toContain(".vacation-constancia");
  });

  it("keeps article text and the year-6 reading off the component", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/people/vacation-constancia.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(
      /Art\.\s*81|artículo 81|prima vacacional|pagar/i,
    );
    expect(source).toContain("print:hidden");
    expect(source).toContain("Nombre y firma de quien expide");
    expect(source).toContain("Firma de la persona trabajadora");
  });
});
