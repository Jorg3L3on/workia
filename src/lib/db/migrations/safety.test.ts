// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateMigrations,
  findRisks,
  formatViolations,
  hasApproval,
} from "./safety";

const migration = (name: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", name), "utf8");
const rules = (sql: string) => findRisks(sql).map((risk) => risk.rule);

describe("findRisks on real migrations", () => {
  it("passes the additive 0011 and 0014", () => {
    expect(findRisks(migration("0011_import_staging.sql"))).toEqual([]);
    expect(findRisks(migration("0014_import_undo.sql"))).toEqual([]);
  });

  it("flags the identifier normalization in 0010", () => {
    expect(rules(migration("0010_person_identity_unique.sql"))).toEqual([
      "UPDATE ... SET",
    ]);
  });

  it("does not treat ON UPDATE/ON DELETE foreign key actions as data changes", () => {
    expect(findRisks(migration("0000_overjoyed_baron_strucker.sql"))).toEqual(
      [],
    );
    expect(findRisks(migration("0003_expediente_audit_catalog.sql"))).toEqual(
      [],
    );
  });
});

describe("findRisks", () => {
  it.each([
    ['DROP TABLE "people";', "DROP TABLE"],
    ["drop table if exists foo cascade;", "DROP TABLE"],
    ['ALTER TABLE "people" DROP COLUMN "nss";', "DROP COLUMN"],
    ["DROP SCHEMA audit CASCADE;", "DROP SCHEMA"],
    ['TRUNCATE "audit_events";', "TRUNCATE"],
    ['DELETE FROM "people" WHERE id = 1;', "DELETE FROM"],
    ["UPDATE \"people\" SET status = 'baja';", "UPDATE ... SET"],
    [
      'ALTER TABLE "T" ALTER COLUMN "p" SET DATA TYPE integer;',
      "ALTER COLUMN ... TYPE",
    ],
    ['ALTER TABLE "T" ALTER COLUMN "p" TYPE text;', "ALTER COLUMN ... TYPE"],
  ])("flags %s", (sql, rule) => {
    expect(rules(sql)).toEqual([rule]);
  });

  it("flags statements inside DO $$ blocks", () => {
    expect(rules('DO $$ BEGIN\n  DELETE FROM "T";\nEND $$;')).toEqual([
      "DELETE FROM",
    ]);
  });

  it("ignores comments and string literals", () => {
    const sql = [
      '-- DROP TABLE "people";',
      '/* TRUNCATE "audit_events"; */',
      "COMMENT ON TABLE \"T\" IS 'we never DELETE FROM here';",
      'ALTER TABLE "T" ADD COLUMN "n" text;',
    ].join("\n");

    expect(findRisks(sql)).toEqual([]);
  });

  it("allows additive and index/constraint changes", () => {
    const sql = [
      'ALTER TABLE "T" ADD COLUMN IF NOT EXISTS "n" text;',
      'ALTER TABLE "T" ALTER COLUMN "n" DROP NOT NULL;',
      'DROP INDEX IF EXISTS "T_n_idx";',
      'ALTER TABLE "T" DROP CONSTRAINT "T_n_chk";',
      'CREATE INDEX "T_m_idx" ON "T" ("m");',
    ].join("\n");

    expect(findRisks(sql)).toEqual([]);
  });

  it("reports the line of the statement", () => {
    const [risk] = findRisks(
      'ALTER TABLE "T" ADD COLUMN "a" text;\n--> statement-breakpoint\nDROP TABLE "Old";',
    );

    expect(risk).toMatchObject({
      rule: "DROP TABLE",
      line: 3,
      text: 'DROP TABLE "Old";',
    });
  });
});

describe("approval", () => {
  const drop = 'ALTER TABLE "people" DROP COLUMN "legacy";';

  it("needs a reason after data-loss-ok", () => {
    expect(
      hasApproval(`-- data-loss-ok: unused since WRK-12, backed up\n${drop}`),
    ).toBe(true);
    expect(hasApproval(`-- data-loss-ok:\n${drop}`)).toBe(false);
    expect(hasApproval(drop)).toBe(false);
  });

  it("fails an unapproved destructive migration and passes it once approved", () => {
    const unapproved = evaluateMigrations([
      { path: "drizzle/0099_x.sql", sql: drop },
    ]);

    expect(unapproved.violations).toHaveLength(1);
    expect(formatViolations(unapproved.violations)).toContain(
      "line 1: DROP COLUMN",
    );

    const approved = evaluateMigrations([
      {
        path: "drizzle/0099_x.sql",
        sql: `-- data-loss-ok: column unused\n${drop}`,
      },
    ]);

    expect(approved).toEqual({
      violations: [],
      approved: ["drizzle/0099_x.sql"],
    });
  });
});
