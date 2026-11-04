import { describe, expect, it } from "vitest";

import type { ScheduleBlock } from "@/lib/people/schedule-blocks";

import { lftHolidays } from "./holidays";
import {
  computeIncidencias,
  type EngineJustification,
  type EnginePersonInput,
  type EnginePunch,
} from "./engine";
import {
  DEFAULT_INCIDENCIA_RULES,
  firstPeriodForChange,
  nextQuincena,
  rulesForPeriod,
  rulesProblem,
  type IncidenciaRules,
} from "./rules";
import type { ContractSchedule } from "./schedule";

/**
 * Scenario tests of the incidencias engine (W2-14). Times are local to
 * America/Mexico_City (UTC-6, no daylight saving time). November 2026:
 * Monday 2 to Friday 6 is a work week, Monday 16 is the LFT holiday of the
 * third Monday of November.
 */

const at = (day: string, time: string, kind: "in" | "out" = "in") => ({
  at: new Date(`${day}T${time}:00-06:00`).toISOString().replace(".000", ""),
  kind,
});

const dayShift: ScheduleBlock = {
  dias: ["lun", "mar", "mie", "jue", "vie"],
  entrada: "08:00",
  salida: "17:00",
  comidaInicio: null,
  comidaFin: null,
};

const nightShift: ScheduleBlock = {
  dias: ["lun", "mar", "mie", "jue", "vie"],
  entrada: "22:00",
  salida: "06:00",
  comidaInicio: null,
  comidaFin: null,
};

const contract = (
  blocks: ScheduleBlock[],
  from = "2026-01-01",
  to: string | null = null,
): ContractSchedule => ({
  from,
  to,
  blocks,
  entrada: null,
  salida: null,
  restDay: "dom",
});

const person = (
  overrides: Partial<EnginePersonInput> = {},
): EnginePersonInput => ({
  personId: "p1",
  siteId: "site-1",
  employment: [{ from: "2025-01-01", to: null }],
  contracts: [contract([dayShift])],
  personSchedule: null,
  punches: [],
  justifications: [],
  vacations: [],
  ...overrides,
});

const LATER = new Date("2026-12-31T00:00:00Z");

/** One day of a person with a day shift and these punches. */
const oneDay = (
  day: string,
  punches: EnginePunch[],
  options: {
    rules?: Partial<IncidenciaRules>;
    input?: Partial<EnginePersonInput>;
  } = {},
) =>
  computeIncidencias(
    person({ punches, ...options.input }),
    { from: day, to: day },
    { ...DEFAULT_INCIDENCIA_RULES, ...options.rules },
    LATER,
  ).map(
    ({ day: date, kind, minutes, justified, justificationRef, voided }) => ({
      day: date,
      kind,
      minutes,
      justified,
      justificationRef,
      voided,
    }),
  );

const plain = (day: string, kind: string, minutes: number | null) => ({
  day,
  kind,
  minutes,
  justified: false,
  justificationRef: null,
  voided: false,
});

const TUE = "2026-11-03";
const fullDay = [at(TUE, "07:58"), at(TUE, "17:02", "out")];

describe("computeIncidencias: punches against the shift", () => {
  it("1. on time in and out: nothing", () => {
    expect(oneDay(TUE, fullDay)).toEqual([]);
  });

  it("2. late within the tolerance (10 minutes by default): nothing", () => {
    expect(oneDay(TUE, [at(TUE, "08:10"), at(TUE, "17:00", "out")])).toEqual(
      [],
    );
  });

  it("3. one minute past the tolerance: a retardo counted from the entry time", () => {
    expect(oneDay(TUE, [at(TUE, "08:11"), at(TUE, "17:00", "out")])).toEqual([
      plain(TUE, "retardo", 11),
    ]);
  });

  it("4. the company's tolerance applies: 0 minutes makes one minute late a retardo", () => {
    expect(
      oneDay(TUE, [at(TUE, "08:01"), at(TUE, "17:00", "out")], {
        rules: { retardoToleranceMinutes: 0 },
      }),
    ).toEqual([plain(TUE, "retardo", 1)]);
  });

  it("5. a late arrival past the falta rule is a falta, not a retardo", () => {
    expect(
      oneDay(TUE, [at(TUE, "08:45"), at(TUE, "17:00", "out")], {
        rules: { faltaAfterMinutes: 30 },
      }),
    ).toEqual([plain(TUE, "falta", null)]);
  });

  it("6. no punches on a workday: a falta", () => {
    expect(oneDay(TUE, [])).toEqual([plain(TUE, "falta", null)]);
  });

  it("7. leaving early: a salida anticipada with the minutes", () => {
    expect(oneDay(TUE, [at(TUE, "08:00"), at(TUE, "16:30", "out")])).toEqual([
      plain(TUE, "salida_anticipada", 30),
    ]);
  });

  it("8. leaving early within the exit tolerance: nothing", () => {
    expect(
      oneDay(TUE, [at(TUE, "08:00"), at(TUE, "16:55", "out")], {
        rules: { salidaToleranceMinutes: 5 },
      }),
    ).toEqual([]);
  });

  it("9. late and leaving early the same day: both", () => {
    expect(oneDay(TUE, [at(TUE, "08:20"), at(TUE, "16:00", "out")])).toEqual([
      plain(TUE, "retardo", 20),
      plain(TUE, "salida_anticipada", 60),
    ]);
  });
});

describe("computeIncidencias: double punches and inferred kinds", () => {
  it("10. a double punch at the door does not move the entry nor the exit", () => {
    expect(
      oneDay(TUE, [
        at(TUE, "07:59"),
        at(TUE, "08:01", "out"),
        at(TUE, "17:00", "in"),
      ]),
    ).toEqual([]);
  });

  it("11. a double punch and no exit: the entry counts, no salida anticipada is invented", () => {
    expect(oneDay(TUE, [at(TUE, "08:20"), at(TUE, "08:21", "out")])).toEqual([
      plain(TUE, "retardo", 20),
    ]);
  });

  it("12. kinds inferred by order (in, out, in): first punch in, last punch out", () => {
    expect(
      oneDay(TUE, [
        at(TUE, "08:00", "in"),
        at(TUE, "13:00", "out"),
        at(TUE, "17:00", "in"),
      ]),
    ).toEqual([]);
  });

  it("13. a single punch the checador marked as exit: the exit counts", () => {
    expect(oneDay(TUE, [at(TUE, "15:00", "out")])).toEqual([
      plain(TUE, "salida_anticipada", 120),
    ]);
  });
});

describe("computeIncidencias: night shifts", () => {
  const night = { input: { contracts: [contract([nightShift])] } };

  it("14. a night shift with its exit after midnight: nothing", () => {
    expect(
      oneDay(TUE, [at(TUE, "21:55"), at("2026-11-04", "06:01", "out")], night),
    ).toEqual([]);
  });

  it("15. late in and early out of a night shift count for the day it started", () => {
    expect(
      oneDay(TUE, [at(TUE, "22:25"), at("2026-11-04", "05:30", "out")], night),
    ).toEqual([plain(TUE, "retardo", 25), plain(TUE, "salida_anticipada", 30)]);
  });

  it("16. the morning exit of the shift before the range is not this day's entry", () => {
    // The exit at 06:00 of Tuesday 17 ends the night shift of Monday 16 (a
    // holiday, so it is not judged), not the one starting at 22:00 on the
    // 17th: that one has no punches, a falta rather than an early entry.
    const result = computeIncidencias(
      person({
        contracts: [contract([nightShift])],
        punches: [at("2026-11-17", "06:00", "out")],
      }),
      { from: "2026-11-17", to: "2026-11-17" },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    expect(result.map((item) => item.kind)).toEqual(["falta"]);
  });
});

describe("computeIncidencias: which shift applies", () => {
  it("17. a rest day, a day outside the blocks and an LFT holiday have no incidencias", () => {
    const week = computeIncidencias(
      person(),
      { from: "2026-11-14", to: "2026-11-16" },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    // Saturday 14 (not in the block), Sunday 15 (rest), Monday 16 (holiday).
    expect(week).toEqual([]);
    expect(lftHolidays(2026).has("2026-11-16")).toBe(true);
  });

  it("18. a contract change in the middle of the quincena changes the shift from its start", () => {
    const afternoon: ScheduleBlock = {
      ...dayShift,
      entrada: "14:00",
      salida: "22:00",
    };
    const result = computeIncidencias(
      person({
        contracts: [
          contract([dayShift], "2026-01-01", "2026-11-04"),
          contract([afternoon], "2026-11-05", null),
        ],
        punches: [
          at("2026-11-04", "08:00"),
          at("2026-11-04", "17:00", "out"),
          at("2026-11-05", "14:20"),
          at("2026-11-05", "22:00", "out"),
        ],
      }),
      { from: "2026-11-04", to: "2026-11-05" },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    expect(
      result.map(({ day, kind, minutes }) => [day, kind, minutes]),
    ).toEqual([["2026-11-05", "retardo", 20]]);
  });

  it("19. with no contract schedule, the person's own schedule applies (simple: every day but the rest day)", () => {
    const result = computeIncidencias(
      person({
        contracts: [],
        personSchedule: {
          blocks: null,
          entrada: "09:00",
          salida: "18:00",
          restDay: "sab",
        },
        punches: [at("2026-11-08", "09:00"), at("2026-11-08", "18:00", "out")],
      }),
      { from: "2026-11-07", to: "2026-11-09" },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    // Saturday 7 rests; Sunday 8 worked; Monday 9 missing.
    expect(result.map(({ day, kind }) => [day, kind])).toEqual([
      ["2026-11-09", "falta"],
    ]);
  });

  it("20. no schedule at all: nothing to compare against, no incidencias", () => {
    expect(
      oneDay(TUE, [], { input: { contracts: [], personSchedule: null } }),
    ).toEqual([]);
  });

  it("21. days outside employment (before the ingreso, after the baja) have none", () => {
    const result = computeIncidencias(
      person({ employment: [{ from: "2026-11-04", to: "2026-11-05" }] }),
      { from: "2026-11-02", to: "2026-11-06" },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    expect(result.map(({ day }) => day)).toEqual(["2026-11-04", "2026-11-05"]);
  });

  it("22. a shift that has not ended yet is not judged", () => {
    const result = computeIncidencias(
      person({ punches: [at(TUE, "08:30")] }),
      { from: TUE, to: TUE },
      DEFAULT_INCIDENCIA_RULES,
      new Date(`${TUE}T16:00:00-06:00`),
    );

    expect(result).toEqual([]);
  });
});

describe("computeIncidencias: justifications", () => {
  const justification = (
    overrides: Partial<EngineJustification>,
  ): EngineJustification => ({
    id: "j1",
    kind: "permiso_con_goce",
    fromDay: TUE,
    toDay: TUE,
    incidenciaKind: null,
    effect: "justify",
    ...overrides,
  });

  it("23. a vacation justifies the falta of its days", () => {
    expect(
      oneDay(TUE, [], {
        input: { vacations: [{ id: "v1", fromDay: TUE, toDay: "2026-11-05" }] },
      }),
    ).toEqual([
      {
        ...plain(TUE, "falta", null),
        justified: true,
        justificationRef: "vacation:v1",
      },
    ]);
  });

  it("24. a permiso or an IMSS incapacidad justifies every incidencia of its days", () => {
    expect(
      oneDay(TUE, [at(TUE, "10:00"), at(TUE, "17:00", "out")], {
        input: { justifications: [justification({})] },
      }),
    ).toEqual([
      {
        ...plain(TUE, "retardo", 120),
        justified: true,
        justificationRef: "permiso_con_goce:j1",
      },
    ]);
    expect(
      oneDay(TUE, [], {
        input: {
          justifications: [
            justification({
              id: "j2",
              kind: "incapacidad_imss",
              fromDay: "2026-11-01",
            }),
          ],
        },
      })[0],
    ).toMatchObject({
      justified: true,
      justificationRef: "incapacidad_imss:j2",
    });
  });

  it("25. an HR override voids or justifies one kind of one day; the latest wins", () => {
    const override = (id: string, effect: "justify" | "void") =>
      justification({
        id,
        kind: "override",
        incidenciaKind: "retardo",
        effect,
      });
    const punches = [at(TUE, "08:30"), at(TUE, "16:00", "out")];

    expect(
      oneDay(TUE, punches, {
        input: {
          justifications: [override("o1", "justify"), override("o2", "void")],
        },
      }),
    ).toEqual([
      {
        ...plain(TUE, "retardo", 30),
        justificationRef: "override:o2",
        voided: true,
      },
      plain(TUE, "salida_anticipada", 60),
    ]);
    expect(
      oneDay(TUE, punches, {
        input: {
          justifications: [override("o2", "void"), override("o3", "justify")],
        },
      })[0],
    ).toMatchObject({
      justified: true,
      voided: false,
      justificationRef: "override:o3",
    });
  });

  it("26. the incidencia keeps the site of the day's attendance row", () => {
    const [falta] = computeIncidencias(
      person({ attendanceSites: { [TUE]: "site-2" } }),
      { from: TUE, to: TUE },
      DEFAULT_INCIDENCIA_RULES,
      LATER,
    );

    expect(falta.siteId).toBe("site-2");
  });
});

describe("rules", () => {
  it("start in the next quincena and resolve by period", () => {
    expect(firstPeriodForChange("2026-11-04")).toBe("2026-11-Q2");
    expect(firstPeriodForChange("2026-12-20")).toBe("2027-01-Q1");
    expect(nextQuincena("2026-11-Q1")).toBe("2026-11-Q2");

    const history = [
      {
        ...DEFAULT_INCIDENCIA_RULES,
        retardoToleranceMinutes: 5,
        effectivePeriod: "2026-11-Q2",
      },
      {
        ...DEFAULT_INCIDENCIA_RULES,
        retardoToleranceMinutes: 15,
        effectivePeriod: "2027-01-Q1",
      },
    ];

    expect(rulesForPeriod(history, "2026-11-Q1")).toMatchObject({
      retardoToleranceMinutes: 10,
      effectivePeriod: null,
    });
    expect(rulesForPeriod(history, "2026-12-Q2")).toMatchObject({
      retardoToleranceMinutes: 5,
    });
    expect(rulesForPeriod(history, "2027-02-Q1")).toMatchObject({
      retardoToleranceMinutes: 15,
    });
  });

  it("refuse tolerances out of range and a falta rule under the tolerance", () => {
    expect(rulesProblem(DEFAULT_INCIDENCIA_RULES)).toBeNull();
    expect(
      rulesProblem({
        ...DEFAULT_INCIDENCIA_RULES,
        retardoToleranceMinutes: -1,
      }),
    ).not.toBeNull();
    expect(
      rulesProblem({
        ...DEFAULT_INCIDENCIA_RULES,
        salidaToleranceMinutes: 121,
      }),
    ).not.toBeNull();
    expect(
      rulesProblem({ ...DEFAULT_INCIDENCIA_RULES, faltaAfterMinutes: 10 }),
    ).not.toBeNull();
    expect(
      rulesProblem({
        ...DEFAULT_INCIDENCIA_RULES,
        faltaAfterMinutes: Number.NaN,
      }),
    ).not.toBeNull();
  });
});

describe("lftHolidays", () => {
  it("lists the article 74 days, with 1 October every six years", () => {
    expect([...lftHolidays(2026)].sort()).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
    expect(lftHolidays(2030).has("2030-10-01")).toBe(true);
  });
});
