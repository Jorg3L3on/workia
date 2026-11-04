import { describe, expect, it } from "vitest";

import type { TurnoverFact } from "../turnover/schema";

import { buildAbsenteeismReport, siteFilterOf, type SiteInfo } from "./report";
import { absenteeismFilterSchema } from "./schema";

const R1 = "00000000-0000-4000-8000-0000000000a1";
const S1 = "00000000-0000-4000-8000-0000000000b1";
const S2 = "00000000-0000-4000-8000-0000000000b2";
const S3 = "00000000-0000-4000-8000-0000000000b3";
const GONE = "00000000-0000-4000-8000-0000000000b4";

const SITES: SiteInfo[] = [
  { id: S1, name: "Monterrey", regionId: R1, deleted: false },
  { id: S2, name: "Apodaca", regionId: R1, deleted: false },
  { id: S3, name: "Puebla", regionId: null, deleted: false },
  { id: GONE, name: "Cerrada", regionId: R1, deleted: true },
];

let next = 0;

const fact = (overrides: Partial<TurnoverFact>): TurnoverFact => ({
  id: `p${next++}`,
  personId: `person${next}`,
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
  siteId: S1,
  positionId: null,
  managerId: null,
  firstOfPerson: true,
  previousRecontratable: null,
  hasLaterPeriod: false,
  ...overrides,
});

const filter = (input: Record<string, unknown> = {}) =>
  absenteeismFilterSchema.parse({
    from: "2026-10-01",
    to: "2026-10-31",
    ...input,
  });

const build = (
  facts: TurnoverFact[],
  input: Record<string, unknown> = {},
  absenteeism = [
    {
      key: S1,
      presentDays: 90,
      absentDays: 10,
      justifiedAbsentDays: 2,
      rate: 0.1,
    },
    {
      key: S3,
      presentDays: 30,
      absentDays: 0,
      justifiedAbsentDays: 0,
      rate: 0,
    },
    {
      key: null,
      presentDays: 5,
      absentDays: 5,
      justifiedAbsentDays: 0,
      rate: 0.5,
    },
  ],
) =>
  buildAbsenteeismReport({
    facts,
    sites: SITES,
    regions: [{ id: R1, name: "Norte" }],
    absenteeism,
    incidencias: [
      { key: S1, kind: "retardo", count: 4, justified: 0, minutes: 40 },
      { key: S1, kind: "falta", count: 10, justified: 2, minutes: 0 },
    ],
    filter: filter(input),
    today: "2026-11-04",
  });

const sixAtS1 = () => [
  ...Array.from({ length: 5 }, () => fact({})),
  fact({ fechaBaja: "2026-10-15", tipoBaja: "voluntaria" }),
];

describe("buildAbsenteeismReport", () => {
  it("groups sucursales under their región, «Sin región» last", () => {
    const report = build(sixAtS1());

    expect(report.regions.map((row) => row.label)).toEqual([
      "Norte",
      "Sin región",
    ]);
    expect(report.regions[0].sites.map((row) => row.label)).toEqual([
      "Apodaca",
      "Monterrey",
    ]);
    expect(report.regions[1].sites.map((row) => row.label)).toEqual([
      "Puebla",
      "Sin sucursal",
    ]);
  });

  it("computes the rate of each group from its own rows", () => {
    const report = build(sixAtS1());
    const monterrey = report.regions[0].sites[1];

    expect(monterrey.turnover).toMatchObject({
      exits: 1,
      voluntaryExits: 1,
      headcount: 5.5,
    });
    expect(monterrey.turnover.rate).toBeCloseTo((1 / 5.5) * 100, 5);
    expect(monterrey.absenteeism).toEqual({
      presentDays: 90,
      absentDays: 10,
      justifiedAbsentDays: 2,
      rate: 10,
      lateDays: 4,
      lateMinutes: 40,
    });
    // 15 faltas over 140 days, not the mean of the three rates.
    expect(report.total.absenteeism.absentDays).toBe(15);
    expect(report.total.absenteeism.rate).toBeCloseTo((15 / 140) * 100, 2);
  });

  it("hides the turnover rate of a small group but keeps its counts", () => {
    const report = build([
      fact({ siteId: S2 }),
      fact({ siteId: S2, fechaBaja: "2026-10-03" }),
    ]);
    const apodaca = report.regions[0].sites[0];

    expect(apodaca.turnover.exits).toBe(1);
    expect(apodaca.turnover.rate).toBeNull();
    expect(apodaca.turnover.smallSample).toBe(true);
  });

  it("shows a deleted sucursal only while it has numbers", () => {
    const without = build(sixAtS1());
    const withExit = build([
      ...sixAtS1(),
      fact({ siteId: GONE, fechaBaja: "2026-10-02" }),
    ]);
    const labels = (report: ReturnType<typeof build>) =>
      report.regions.flatMap((region) => region.sites.map((row) => row.label));

    expect(labels(without)).not.toContain("Cerrada");
    expect(labels(withExit)).toContain("Cerrada");
  });

  it("narrows to the selected región and leaves people without sucursal out", () => {
    const report = build(
      [...sixAtS1(), fact({ siteId: null, fechaBaja: "2026-10-04" })],
      { regionIds: [R1] },
    );

    expect(report.regions.map((row) => row.key)).toEqual([R1]);
    expect(report.total.turnover.exits).toBe(1);
    expect(report.total.absenteeism.absentDays).toBe(10);
  });
});

describe("siteFilterOf", () => {
  it("keeps everything without filters and intersects región and sucursal", () => {
    expect(siteFilterOf({ regionIds: [], siteIds: [] }, SITES)(null)).toBe(
      true,
    );

    const both = siteFilterOf({ regionIds: [R1], siteIds: [S1, S3] }, SITES);
    expect([S1, S2, S3, null].map(both)).toEqual([true, false, false, false]);
  });
});
