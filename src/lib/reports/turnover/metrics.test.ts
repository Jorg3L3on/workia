import { describe, expect, it } from "vitest";

import { buildTurnoverReport, countedBy, populationOf } from "./report";
import {
  breakdown,
  cohorts,
  exitClassification,
  isTrialExit,
  monthHeadcount,
  OTHERS_KEY,
  rangeHeadcount,
  rate,
  rollingYear,
  summarize,
  tenureAtExit,
  trialFunnel,
} from "./metrics";
import {
  previousRange,
  shiftRangeByMonths,
  monthsBetween,
  addDays,
} from "./dates";
import { turnoverFilterSchema, type TurnoverFact } from "./schema";

let next = 0;

/** A synthetic period; every name and id is made up. */
const fact = (overrides: Partial<TurnoverFact> = {}): TurnoverFact => {
  next += 1;

  return {
    id: `p${next}`,
    personId: `x${next}`,
    personName: `Persona ${next}`,
    fechaIngreso: "2024-01-01",
    fechaBaja: null,
    bajaSinFecha: false,
    fechaBajaInferida: false,
    requiereRevision: false,
    tipoBaja: null,
    motivoId: null,
    motivoName: null,
    motivoClassification: null,
    recontratable: null,
    areaId: "area-1",
    siteId: null,
    positionId: null,
    managerId: null,
    firstOfPerson: true,
    previousRecontratable: null,
    hasLaterPeriod: false,
    ...overrides,
  };
};

const active = (count: number, overrides: Partial<TurnoverFact> = {}) =>
  Array.from({ length: count }, () => fact(overrides));

const exit = (
  fechaBaja: string,
  overrides: Partial<TurnoverFact> = {},
): TurnoverFact =>
  fact({
    fechaBaja,
    tipoBaja: "voluntaria",
    motivoId: "m-renuncia",
    motivoName: "Renuncia voluntaria",
    motivoClassification: "voluntaria",
    recontratable: true,
    ...overrides,
  });

describe("plantilla", () => {
  it("is (active on the 1st + active at the close of the last day) / 2", () => {
    const periods = [
      ...active(10),
      fact({ fechaIngreso: "2026-03-10" }),
      exit("2026-03-15"),
    ];

    expect(monthHeadcount(periods, "2026-03")).toMatchObject({
      start: 11,
      end: 11,
      average: 11,
    });
  });

  it("a baja on the last day counts in that month, not in the final nor the next month's plantilla", () => {
    const leaver = exit("2026-03-31");
    const periods = [...active(9), leaver];

    expect(monthHeadcount(periods, "2026-03")).toMatchObject({
      start: 10,
      end: 9,
    });
    expect(monthHeadcount(periods, "2026-04")).toMatchObject({
      start: 9,
      end: 9,
    });
    expect(summarize(periods, "2026-03-01", "2026-03-31").exits).toBe(1);
    expect(summarize(periods, "2026-04-01", "2026-04-30").exits).toBe(0);
  });

  it("a baja «sin fecha» is in no plantilla and no count", () => {
    const periods = [
      ...active(4),
      fact({ bajaSinFecha: true, requiereRevision: true }),
    ];

    expect(monthHeadcount(periods, "2026-03").average).toBe(4);
    expect(summarize(periods, "2026-03-01", "2026-03-31").exits).toBe(0);
  });

  it("a period without fecha de ingreso counts in the plantilla and its baja counts", () => {
    const unknown = exit("2026-03-20", { fechaIngreso: null });
    const periods = [...active(9), unknown];
    const summary = summarize(periods, "2026-03-01", "2026-03-31");

    expect(monthHeadcount(periods, "2026-03")).toMatchObject({
      start: 10,
      end: 9,
    });
    expect(summary.exits).toBe(1);
    // …but it is out of the trial share, cohorts and tenure.
    expect(summary.trial.exitsWithIngreso).toBe(0);
    expect(summary.tenure.meanDays).toBeNull();
    expect(cohorts(periods, ["2026-03"], "2026-12-31")[0].hires).toBe(0);
  });

  it("someone hired and gone in the same month is a baja of that month", () => {
    const periods = [
      ...active(10),
      exit("2026-03-20", { fechaIngreso: "2026-03-02" }),
    ];
    const summary = summarize(periods, "2026-03-01", "2026-03-31");

    expect(monthHeadcount(periods, "2026-03")).toMatchObject({
      start: 10,
      end: 10,
    });
    expect(summary.exits).toBe(1);
    expect(summary.hires).toBe(1);
    expect(summary.rate).toBe(10);
  });

  it("a quarter is the mean of its 3 monthly plantillas, not a sum of monthly rates", () => {
    // January 10 → February 10 → March 20 people, one baja a month.
    const periods = [
      ...active(9),
      ...active(10, { fechaIngreso: "2026-03-01" }),
      exit("2026-01-15"),
      exit("2026-02-15"),
      exit("2026-03-15"),
      fact({ fechaIngreso: "2026-01-15" }),
      fact({ fechaIngreso: "2026-02-15" }),
    ];
    const months = ["2026-01", "2026-02", "2026-03"].map((month) =>
      monthHeadcount(periods, month),
    );
    const quarter = summarize(periods, "2026-01-01", "2026-03-31");
    const sumOfMonthlyRates = ["01", "02", "03"]
      .map(
        (month) =>
          summarize(
            periods,
            `2026-${month}-01`,
            `2026-${month}-${month === "02" ? "28" : "31"}`,
          ).rate!,
      )
      .reduce((sum, value) => sum + value, 0);
    const meanHeadcount =
      months.reduce((sum, month) => sum + month.average, 0) / 3;

    expect(quarter.headcount).toBeCloseTo(meanHeadcount, 2);
    expect(quarter.exits).toBe(3);
    expect(quarter.rate).toBeCloseTo((3 / meanHeadcount) * 100, 6);
    expect(quarter.rate).not.toBeCloseTo(sumOfMonthlyRates, 2);
  });

  it("a range that is not whole months uses (start + end) / 2 of the range", () => {
    const periods = [...active(10), exit("2026-03-10")];

    expect(rangeHeadcount(periods, "2026-03-05", "2026-03-20")).toBe(10.5);
  });

  it("an empty plantilla has no rate, not infinity", () => {
    expect(rate(1, 0)).toBeNull();
    expect(summarize([], "2026-03-01", "2026-03-31").rate).toBeNull();
  });

  it("a rehire's two periods are two bajas and two ingresos", () => {
    const first = exit("2025-04-30", {
      personId: "same",
      fechaIngreso: "2025-02-01",
    });
    const second = exit("2025-10-31", {
      personId: "same",
      fechaIngreso: "2025-08-01",
      firstOfPerson: false,
      previousRecontratable: true,
    });
    const summary = summarize(
      [...active(10), first, second],
      "2025-01-01",
      "2025-12-31",
    );

    expect(summary.exits).toBe(2);
    expect(summary.hires).toBe(2);
    expect(summary.reentries.count).toBe(1);
  });
});

describe("salida en prueba", () => {
  it("a baja on day 90 exactly counts; day 91 does not", () => {
    expect(
      isTrialExit(exit("2026-03-31", { fechaIngreso: "2026-01-01" })),
    ).toBe(true);
    expect(
      isTrialExit(exit("2026-04-01", { fechaIngreso: "2026-01-01" })),
    ).toBe(false);
  });

  it("uses the period's ingreso, never recognized seniority: a rehire starts over", () => {
    // Recognized seniority lives on the period as fecha_antiguedad, which the
    // report never reads: only fechaIngreso decides.
    const rehire = exit("2026-03-01", {
      fechaIngreso: "2026-01-15",
      firstOfPerson: false,
    });
    const summary = summarize(
      [...active(10), rehire],
      "2026-03-01",
      "2026-03-31",
    );

    expect(summary.trial).toMatchObject({ exits: 1, exitsWithIngreso: 1 });
    expect(summary.trial.share).toBe(100);
  });
});

describe("clasificación", () => {
  it("comes from the motivo, so reclassifying it changes the split", () => {
    const base = exit("2026-03-10", {
      tipoBaja: "termino_contrato",
      motivoId: "m-no-renovar",
      motivoName: "No aceptó renovar contrato",
      motivoClassification: "voluntaria",
    });

    expect(exitClassification(base)).toBe("voluntaria");
    expect(
      exitClassification({ ...base, motivoClassification: "involuntaria" }),
    ).toBe("involuntaria");
  });

  it("an unclassified motivo counts as otra", () => {
    expect(
      exitClassification(
        exit("2026-03-10", {
          motivoId: "m-heredado",
          motivoClassification: null,
        }),
      ),
    ).toBe("otra");
  });

  it("a baja without motivo falls back to its tipo", () => {
    const without = (tipoBaja: TurnoverFact["tipoBaja"]) =>
      exitClassification(
        exit("2026-03-10", {
          tipoBaja,
          motivoId: null,
          motivoClassification: null,
        }),
      );

    expect(without("voluntaria")).toBe("voluntaria");
    expect(without("despido")).toBe("involuntaria");
    expect(without("termino_contrato")).toBe("involuntaria");
    expect(without("otra")).toBe("otra");
    expect(without(null)).toBe("otra");
  });

  it("the three classified rates add up to the total", () => {
    const periods = [
      ...active(17),
      exit("2026-03-05"),
      exit("2026-03-06", { motivoClassification: "involuntaria" }),
      exit("2026-03-07", { motivoClassification: null }),
    ];
    const summary = summarize(periods, "2026-03-01", "2026-03-31");

    expect(
      summary.byClass.voluntaria.rate! +
        summary.byClass.involuntaria.rate! +
        summary.byClass.otra.rate!,
    ).toBeCloseTo(summary.rate!, 6);
  });
});

describe("desgloses", () => {
  it("folds groups with a plantilla under 5 into «Otros»", () => {
    const periods = [
      ...active(8, { areaId: "almacen" }),
      exit("2026-03-10", { areaId: "almacen" }),
      ...active(2, { areaId: "caja" }),
      exit("2026-03-10", { areaId: "caja" }),
      ...active(1, { areaId: "ventas" }),
    ];
    const rows = breakdown(periods, "area", "2026-03-01", "2026-03-31");

    expect(rows.map((row) => row.key)).toEqual(["almacen", OTHERS_KEY]);
    expect(rows[1]).toMatchObject({
      exits: 1,
      members: expect.arrayContaining(["caja", "ventas"]),
    });
    // «Otros» is still under 5 people: no rate on its own either.
    expect(rows[1].rate).toBeNull();
  });
});

describe("12 meses", () => {
  it("is exact with 12 months of history and «estimada» before", () => {
    const periods = [...active(20), exit("2026-02-10"), exit("2026-03-10")];

    expect(rollingYear(periods, "2026-03", "2025-01")).toMatchObject({
      estimated: false,
      months: 12,
      exits: 2,
    });
    expect(rollingYear(periods, "2026-03", "2026-02")).toMatchObject({
      estimated: true,
      months: 2,
    });
    expect(rollingYear(periods, "2026-03", null).rate).toBeNull();
  });
});

describe("cohortes y embudo", () => {
  it("retention at 30/60/90 days, immature cells marked", () => {
    const hires = [
      fact({ fechaIngreso: "2026-01-05" }),
      exit("2026-01-20", { fechaIngreso: "2026-01-05" }),
      exit("2026-02-20", { fechaIngreso: "2026-01-05" }),
      exit("2026-03-20", { fechaIngreso: "2026-01-05" }),
    ];
    const [row] = cohorts(hires, ["2026-01"], "2026-03-15");

    expect(row.hires).toBe(4);
    expect(row.smallSample).toBe(true);
    // Day 30 = Feb 4, day 60 = Mar 6, day 90 = Apr 5.
    expect(row.cells.map((cell) => cell.retained)).toEqual([3, 2, 1]);
    expect(row.cells.map((cell) => cell.mature)).toEqual([true, false, false]);

    const funnel = trialFunnel(hires, "2026-01-01", "2026-01-31", "2026-06-01");

    expect(funnel.hires).toBe(4);
    expect(funnel.steps.map((step) => step.active)).toEqual([3, 2, 1]);
    expect(funnel.biggestDrop).toMatchObject({ from: 0, to: 30, lost: 1 });
  });
});

describe("antigüedad al salir", () => {
  it("buckets days worked", () => {
    const buckets = tenureAtExit([
      exit("2026-01-30", { fechaIngreso: "2026-01-01" }),
      exit("2026-03-31", { fechaIngreso: "2026-01-01" }),
      exit("2026-03-31", { fechaIngreso: "2020-01-01" }),
    ]);

    expect(
      Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.exits])),
    ).toMatchObject({ "0-30": 1, "61-90": 1, "3a+": 1 });
  });
});

describe("filters", () => {
  const filter = (input: Record<string, unknown>) =>
    turnoverFilterSchema.parse({
      from: "2026-03-01",
      to: "2026-03-31",
      ...input,
    });

  it("tipo, motivo and clasificación narrow the bajas, not the plantilla", () => {
    const periods = [
      ...active(18),
      exit("2026-03-05"),
      exit("2026-03-06", {
        tipoBaja: "despido",
        motivoId: "m-faltas",
        motivoClassification: "involuntaria",
      }),
    ];
    const voluntary = filter({ classifications: ["voluntaria"] });
    const summary = summarize(
      periods,
      voluntary.from,
      voluntary.to,
      countedBy(voluntary),
    );

    expect(summary.exits).toBe(1);
    expect(summary.headcount).toBe(19);
  });

  it("jefe with «todo el equipo» follows the reporting tree", () => {
    const periods = [
      fact({ managerId: "boss" }),
      fact({ managerId: "lead" }),
      fact({ managerId: "other" }),
    ];
    const labels = { reportsOf: { boss: ["lead"], lead: ["worker"] } };

    expect(
      populationOf(
        periods,
        filter({ managerId: "8e1c0c43-0000-4000-8000-000000000000" }),
        labels,
      ),
    ).toHaveLength(0);

    const direct = filter({});
    direct.managerId = "boss";
    expect(populationOf(periods, direct, labels)).toHaveLength(1);
    expect(
      populationOf(periods, { ...direct, team: true }, labels),
    ).toHaveLength(2);
  });

  it("rejects a reversed or too long range", () => {
    expect(
      turnoverFilterSchema.safeParse({ from: "2026-03-31", to: "2026-03-01" })
        .success,
    ).toBe(false);
    expect(
      turnoverFilterSchema.safeParse({ from: "2015-01-01", to: "2026-03-01" })
        .success,
    ).toBe(false);
  });
});

describe("dates", () => {
  it("moves ranges by whole months and finds the previous one", () => {
    expect(previousRange("2026-01-01", "2026-03-31")).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
    expect(shiftRangeByMonths("2026-02-01", "2026-02-28", -12)).toEqual({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(previousRange("2026-03-05", "2026-03-14")).toEqual({
      from: "2026-02-23",
      to: "2026-03-04",
    });
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("buildTurnoverReport", () => {
  it("counts each period to review once", () => {
    const report = buildTurnoverReport(
      [
        ...active(5),
        fact({ bajaSinFecha: true, requiereRevision: true }),
        exit("2026-03-10", { fechaBajaInferida: true, requiereRevision: true }),
      ],
      turnoverFilterSchema.parse({ from: "2026-03-01", to: "2026-03-31" }),
      {
        labels: {
          areas: {},
          sites: {},
          positions: {},
          managers: {},
          reportsOf: {},
        },
        goal: null,
        today: "2026-04-15",
        unclassifiedReasons: 0,
        withDetail: false,
      },
    );

    expect(report.quality).toMatchObject({
      sinFecha: 1,
      inferidas: 1,
      requiereRevision: 2,
      toReview: 2,
    });
  });

  it("puts the goal on the range and the history start on the first baja", () => {
    const report = buildTurnoverReport(
      [...active(20), exit("2026-02-10"), exit("2026-03-10")],
      turnoverFilterSchema.parse({ from: "2026-01-01", to: "2026-03-31" }),
      {
        labels: {
          areas: { "area-1": "Almacén" },
          sites: {},
          positions: {},
          managers: {},
          reportsOf: {},
        },
        goal: 2,
        today: "2026-04-15",
        unclassifiedReasons: 1,
        withDetail: true,
      },
    );

    expect(report.months).toBe(3);
    expect(report.goal).toEqual({ monthly: 2, forRange: 6 });
    expect(report.historyStart).toBe("2026-02");
    expect(report.lastYear).toBeNull();
    expect(report.breakdowns.area[0].label).toBe("Almacén");
    expect(report.detail?.exits).toHaveLength(2);
    expect(report.quality.unclassifiedReasons).toBe(1);
    expect(report.quality.toReview).toBe(0);
    expect(report.trend).toHaveLength(12);
  });
});
