import { describe, expect, it } from "vitest";

import { isValidCurp, isValidRfc } from "@/lib/people/identity";

import { buildFixtureRows, fixtureCurp, fixtureRfc } from "./fixture";

describe("import fixture", () => {
  it("generates unique, valid identifiers for 5,000 people", () => {
    const curps = new Set<string>();
    const rfcs = new Set<string>();

    for (let i = 0; i < 5000; i += 1) {
      const curp = fixtureCurp(100_000 + i);
      const rfc = fixtureRfc(100_000 + i);

      expect(isValidCurp(curp)).toBe(true);
      expect(isValidRfc(rfc)).toBe(true);
      curps.add(curp);
      rfcs.add(rfc);
    }

    expect(curps.size).toBe(5000);
    expect(rfcs.size).toBe(5000);
  });

  it("never collides across runs", () => {
    const a = new Set(
      Array.from({ length: 2000 }, (_, i) => fixtureCurp(100_000 + i)),
    );

    for (let i = 0; i < 2000; i += 1) {
      expect(a.has(fixtureCurp(200_000 + i))).toBe(false);
    }
  });

  it("builds histories and a known number of seeded errors", () => {
    const { rows, summary } = buildFixtureRows({
      people: 1000,
      withErrors: true,
    });

    expect(summary.people).toBe(1000);
    expect(summary.contratos).toBe(rows.contratos.length);
    expect(summary.brokenPeople).toBeGreaterThan(10);
    expect(summary.brokenContracts).toBeGreaterThan(0);
    // 200 people with 3 contracts and 800 with 1.
    expect(rows.contratos.length).toBe(200 * 3 + 800);

    const clean = buildFixtureRows({ people: 1000 });

    expect(clean.summary.brokenPeople).toBe(0);
  });
});
