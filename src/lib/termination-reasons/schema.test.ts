import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TERMINATION_REASON_SEED } from "./schema";

describe("motivos de baja base list", () => {
  it("is the list migration 0025 seeds", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "drizzle/0025_employment_periods.sql"),
      "utf8",
    );
    const values = sql.slice(
      sql.indexOf("CROSS JOIN (VALUES"),
      sql.indexOf(') AS "seed"'),
    );
    const seeded = [...values.matchAll(/\('([^']+)'\)/g)].map(
      (match) => match[1],
    );

    expect(seeded).toEqual([...TERMINATION_REASON_SEED]);
  });
});
