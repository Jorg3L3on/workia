import { describe, expect, it } from "vitest";

import {
  formatSeniority,
  seniorityDate,
  seniorityParts,
} from "@/lib/people/seniority";

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

describe("seniorityDate", () => {
  const first = {
    fechaIngreso: "2018-02-01",
    reconoceAntiguedad: false,
  };

  it("is the person's ingreso without periods", () => {
    expect(seniorityDate([], "2020-01-15")).toBe("2020-01-15");
    expect(seniorityDate([])).toBeNull();
  });

  it("counts from the only period's ingreso", () => {
    expect(seniorityDate([first], "2018-02-01")).toBe("2018-02-01");
  });

  it("restarts at the last ingreso when the rehire does not recognize it", () => {
    expect(
      seniorityDate([
        { fechaIngreso: "2024-06-10", reconoceAntiguedad: false },
        first,
      ]),
    ).toBe("2024-06-10");
  });

  it("carries over from the first period when the rehire recognizes it", () => {
    expect(
      seniorityDate([
        first,
        { fechaIngreso: "2024-06-10", reconoceAntiguedad: true },
      ]),
    ).toBe("2018-02-01");
  });

  it("uses the explicit recognized date when HR gave one", () => {
    expect(
      seniorityDate([
        first,
        {
          fechaIngreso: "2024-06-10",
          reconoceAntiguedad: true,
          fechaAntiguedadReconocida: "2020-01-01",
        },
      ]),
    ).toBe("2020-01-01");
  });

  it("carries over only as far as the last restart", () => {
    expect(
      seniorityDate([
        first,
        { fechaIngreso: "2021-03-01", reconoceAntiguedad: false },
        { fechaIngreso: "2024-06-10", reconoceAntiguedad: true },
      ]),
    ).toBe("2021-03-01");
  });

  it("formats the same as the hire date it replaces", () => {
    const date = seniorityDate([
      first,
      { fechaIngreso: "2026-01-10", reconoceAntiguedad: true },
    ]);
    expect(formatSeniority(date, "2026-05-15")).toBe("8 años, 3 meses");
    expect(
      formatSeniority(
        seniorityDate([
          first,
          { fechaIngreso: "2026-01-10", reconoceAntiguedad: false },
        ]),
        "2026-05-15",
      ),
    ).toBe("4 meses");
  });
});
