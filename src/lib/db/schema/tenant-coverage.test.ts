import { getTableConfig, PgTable, pgTable, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./index";

/**
 * Tables that are not business data of one company: identity, RBAC templates
 * and the company model itself. Every other table must carry company_id NOT
 * NULL, so a new table (labor cycle included) is born multi-company.
 */
const PLATFORM_TABLES = new Set([
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "companies",
  "company_memberships",
]);

/** Why a business table is not tenant-scoped; empty when it is. */
const tenantProblems = (table: ReturnType<typeof getTableConfig>) => {
  const column = table.columns.find(
    (candidate) => candidate.name === "company_id",
  );
  const problems: string[] = [];

  if (!column) {
    problems.push("no company_id column");
  } else if (!column.notNull) {
    problems.push("company_id is nullable");
  }

  const referencesCompanies = table.foreignKeys.some((foreignKey) => {
    const reference = foreignKey.reference();
    return (
      reference.columns.length === 1 &&
      reference.columns[0].name === "company_id" &&
      getTableConfig(reference.foreignTable).name === "companies"
    );
  });

  if (!referencesCompanies) {
    problems.push("no foreign key company_id → companies");
  }

  return problems;
};

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table));

describe("tenant coverage", () => {
  it("finds the schema's tables", () => {
    expect(tables.map((table) => table.name)).toContain("people");
  });

  it.each(
    tables
      .filter((table) => !PLATFORM_TABLES.has(table.name))
      .map((table) => [table.name, table]),
  )("%s has company_id NOT NULL referencing companies", (_name, table) => {
    expect(tenantProblems(table)).toEqual([]);
  });

  it("fails for a new business table without company_id", () => {
    const newTable = pgTable("labor_regions", { id: uuid("id").primaryKey() });

    expect(tenantProblems(getTableConfig(newTable))).toEqual([
      "no company_id column",
      "no foreign key company_id → companies",
    ]);
  });

  it("lists only platform tables that exist", () => {
    const names = new Set(tables.map((table) => table.name));

    for (const name of PLATFORM_TABLES) {
      expect(names.has(name), name).toBe(true);
    }
  });
});
