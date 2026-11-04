import { describe, expect, it } from "vitest";

import { buildAbsenteeismReport, type SiteInfo } from "../absenteeism/report";
import type { TurnoverFact } from "../turnover/schema";

import { buildGroupDashboard, type CompanyInputs } from "./report";
import { groupFilterSchema } from "./schema";
import { parseGroupParam, serializeGroupFilter } from "./url";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const RA = "00000000-0000-4000-8000-0000000000a1";
const SA = "00000000-0000-4000-8000-0000000000b1";
const SB = "00000000-0000-4000-8000-0000000000b2";

const FILTER = groupFilterSchema.parse({
  from: "2026-10-01",
  to: "2026-10-31",
});

let next = 0;

const fact = (overrides: Partial<TurnoverFact>): TurnoverFact => ({
  id: `period-${next++}`,
  personId: `person-${next}`,
  personName: "Persona",
  fechaIngreso: "2025-01-01",
  fechaBaja: null,
  bajaSinFecha: false,
  fechaBajaInferida: false,
  requiereRevision: false,
  tipoBaja: null,
  motivoId: null,
  motivoName: null,
  motivoClassification: null,
  recontratable: null,
  areaId: null,
  siteId: null,
  positionId: null,
  managerId: null,
  firstOfPerson: true,
  previousRecontratable: null,
  hasLaterPeriod: false,
  ...overrides,
});

const staff = (count: number, siteId: string) =>
  Array.from({ length: count }, () => fact({ siteId }));

const company = (
  overrides: Partial<CompanyInputs> & Pick<CompanyInputs, "companyId">,
): CompanyInputs => ({
  companyName: `Empresa ${overrides.companyId.slice(-1)}`,
  facts: [],
  sites: [],
  regions: [],
  absenteeism: [],
  incidencias: [],
  transfers: new Map(),
  ...overrides,
});

const SITES_A: SiteInfo[] = [
  { id: SA, name: "Monterrey", regionId: RA, deleted: false },
];
const SITES_B: SiteInfo[] = [
  { id: SB, name: "Puebla", regionId: null, deleted: false },
];

/** A in October: ten people, one voluntary baja and one transfer to B. */
const transferOut = fact({
  siteId: SA,
  fechaBaja: "2026-10-15",
  tipoBaja: "traslado",
});
const transferIn = fact({ siteId: SB, fechaIngreso: "2026-10-16" });
const leaver = fact({
  siteId: SA,
  fechaBaja: "2026-10-20",
  tipoBaja: "voluntaria",
});
const hire = fact({ siteId: SB, fechaIngreso: "2026-10-05" });

const companyA = company({
  companyId: A,
  companyName: "Alfa",
  facts: [...staff(8, SA), transferOut, leaver],
  sites: SITES_A,
  regions: [{ id: RA, name: "Norte" }],
  absenteeism: [
    {
      key: SA,
      presentDays: 180,
      absentDays: 20,
      justifiedAbsentDays: 5,
      rate: 0.1,
    },
  ],
  incidencias: [
    { key: SA, kind: "retardo", count: 4, justified: 0, minutes: 60 },
  ],
  transfers: new Map([
    [transferOut.id, { direction: "out" as const, linkedCompanyId: B }],
  ]),
});
const companyB = company({
  companyId: B,
  companyName: "Beta",
  facts: [...staff(6, SB), transferIn, hire],
  sites: SITES_B,
  absenteeism: [
    {
      key: SB,
      presentDays: 95,
      absentDays: 5,
      justifiedAbsentDays: 0,
      rate: 0.05,
    },
  ],
  transfers: new Map([
    [transferIn.id, { direction: "in" as const, linkedCompanyId: A }],
  ]),
});

describe("buildGroupDashboard", () => {
  const dashboard = buildGroupDashboard({
    companies: [companyB, companyA],
    filter: FILTER,
    today: "2026-11-04",
  });

  it("gives each company exactly its absenteeism report", () => {
    const own = buildAbsenteeismReport({
      facts: companyA.facts,
      sites: companyA.sites,
      regions: companyA.regions,
      absenteeism: companyA.absenteeism,
      incidencias: companyA.incidencias,
      filter: { ...FILTER, regionIds: [], siteIds: [] },
      today: "2026-11-04",
    });
    const alfa = dashboard.companies[0];

    expect(dashboard.companies.map((row) => row.companyName)).toEqual([
      "Alfa",
      "Beta",
    ]);
    expect(alfa.report.regions).toEqual(own.regions);
    expect(alfa.report.total.turnover).toEqual(own.total.turnover);
    expect(alfa.report.total.absenteeism).toEqual(own.total.absenteeism);
    // The transfer is a baja of Alfa and an ingreso of Beta.
    expect(alfa.report.total.turnover.exits).toBe(2);
    expect(dashboard.companies[1].report.total.turnover.hires).toBe(2);
    expect(alfa).toMatchObject({ transfersOut: 1, transfersIn: 0 });
    expect(dashboard.companies[1]).toMatchObject({
      transfersOut: 0,
      transfersIn: 1,
    });
  });

  it("adds plantilla and days, and leaves internal transfers out of the group's turnover", () => {
    const { total, companies } = dashboard;

    expect(total.turnover.headcount).toBe(
      companies[0].report.total.turnover.headcount +
        companies[1].report.total.turnover.headcount,
    );
    expect(total.turnover.exits).toBe(1);
    expect(total.turnover.voluntaryExits).toBe(1);
    expect(total.turnover.hires).toBe(1);
    expect(total.turnover.rate).toBeCloseTo(
      (1 / total.turnover.headcount) * 100,
    );
    expect(total).toMatchObject({ transfersOut: 1, transfersIn: 1 });
    expect(total.absenteeism).toMatchObject({
      presentDays: 275,
      absentDays: 25,
      justifiedAbsentDays: 5,
      lateDays: 4,
      lateMinutes: 60,
      rate: 8.33,
    });
  });

  it("counts a transfer to a company outside the view as a baja of the group", () => {
    const alone = buildGroupDashboard({
      companies: [companyA],
      filter: FILTER,
      today: "2026-11-04",
    });

    expect(alone.total.turnover.exits).toBe(2);
    expect(alone.total).toMatchObject({ transfersOut: 0, transfersIn: 0 });
    expect(alone.total.turnover).toEqual(
      alone.companies[0].report.total.turnover,
    );
  });

  it("hides the group's rate under the minimum plantilla but keeps the counts", () => {
    const small = buildGroupDashboard({
      companies: [
        company({
          companyId: C,
          facts: [
            fact({ siteId: null }),
            fact({
              siteId: null,
              fechaBaja: "2026-10-02",
              tipoBaja: "despido",
            }),
          ],
        }),
      ],
      filter: FILTER,
      today: "2026-11-04",
    });

    expect(small.total.turnover.rate).toBeNull();
    expect(small.total.turnover).toMatchObject({
      exits: 1,
      involuntaryExits: 1,
    });
  });

  it("is empty with no company", () => {
    const none = buildGroupDashboard({
      companies: [],
      filter: FILTER,
      today: "2026-11-04",
    });

    expect(none.companies).toEqual([]);
    expect(none.total.turnover).toMatchObject({ headcount: 0, rate: null });
    expect(none.total.absenteeism.rate).toBeNull();
  });
});

describe("group URL", () => {
  it("round-trips and falls back on anything broken", () => {
    const filter = groupFilterSchema.parse({
      from: "2026-01-01",
      to: "2026-03-31",
      companyIds: [A, B],
    });

    expect(parseGroupParam(serializeGroupFilter(filter), "2026-11-04")).toEqual(
      filter,
    );
    expect(parseGroupParam("x1*desde.2026-01-01", "2026-11-04")).toEqual(
      groupFilterSchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
    );
    // A bad company id keeps the range and drops the selection.
    expect(
      parseGroupParam(
        "g1*desde.2026-01-01*hasta.2026-01-31*empresa.nope",
        "2026-11-04",
      ),
    ).toEqual(
      groupFilterSchema.parse({ from: "2026-01-01", to: "2026-01-31" }),
    );
    // More than 400 days falls back to the last closed month.
    expect(
      parseGroupParam("g1*desde.2024-01-01*hasta.2026-01-31", "2026-11-04"),
    ).toEqual(
      groupFilterSchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
    );
  });
});
