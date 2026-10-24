import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TERMINATION_REASON_SEED, terminationReasonFormSchema } from "./schema";

const migration = (file: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", file), "utf8");

/** The rows of a `(VALUES ...) AS "seed"` block, from its first occurrence on. */
const seedValues = (sql: string, from = 0) => {
  const start = sql.indexOf("(VALUES", from);
  const values = sql.slice(start, sql.indexOf(') AS "seed"', start));

  return [...values.matchAll(/\(([^()]+)\)/g)].map((match) =>
    [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]),
  );
};

describe("motivos de baja base list", () => {
  it("starts with the 13 names migration 0025 seeds", () => {
    const seeded = seedValues(migration("0025_employment_periods.sql")).map(
      ([name]) => name,
    );

    expect(seeded).toEqual(
      TERMINATION_REASON_SEED.slice(0, 13).map((reason) => reason.name),
    );
  });

  it("has the classifications and the two trial-period reasons of 0027", () => {
    const sql = migration("0027_turnover_report.sql");
    const classified = seedValues(sql);
    const added = seedValues(sql, sql.indexOf("INSERT INTO"));

    expect([...classified, ...added]).toEqual(
      TERMINATION_REASON_SEED.map((reason) => [
        reason.name,
        reason.classification,
      ]),
    );
  });
});

describe("terminationReasonFormSchema", () => {
  it("keeps a reason sin clasificar when no classification is sent", () => {
    const parsed = terminationReasonFormSchema.parse({ name: "Otro motivo" });

    expect(parsed.classification).toBeNull();
  });

  it("rejects an unknown classification", () => {
    expect(
      terminationReasonFormSchema.safeParse({
        name: "Otro motivo",
        classification: "despido",
      }).success,
    ).toBe(false);
  });
});
