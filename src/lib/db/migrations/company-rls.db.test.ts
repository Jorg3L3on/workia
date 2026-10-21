import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase, testServerUrl } from "@/test/db/scratch";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const A = "00000000-0000-0000-0000-0000000000a0";
const B = "00000000-0000-0000-0000-0000000000b0";
const ROLE = "workia_app_rls_check";

describe("0018: row-level security per company", () => {
  let database: Scratch;
  let app: Client;

  /** Runs `statements` as the app role in one transaction, optionally scoped to a company. */
  const asApp = async <T = Record<string, unknown>>(
    companyId: string | null,
    query: string,
  ) => {
    await app.query("BEGIN");
    try {
      if (companyId) {
        await app.query("SELECT set_config('app.company_id', $1, true)", [
          companyId,
        ]);
      }
      const { rows } = await app.query(query);
      await app.query("COMMIT");
      return rows as T[];
    } catch (error) {
      await app.query("ROLLBACK");
      throw error;
    }
  };

  beforeAll(async () => {
    database = await createScratchDatabase("m0018");
    await database.query(`
      INSERT INTO companies (id, name, slug) VALUES ('${A}', 'A', 'a'), ('${B}', 'B', 'b');
      INSERT INTO people (company_id, nombres, apellido_paterno) VALUES ('${A}', 'Ana', 'A'), ('${B}', 'Beto', 'B');`);

    const owner = new Client({ connectionString: testServerUrl() });
    await owner.connect();
    const exists = await owner.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );
    if (exists.rows.length === 0) {
      await owner.query(
        `CREATE ROLE ${ROLE} LOGIN NOBYPASSRLS PASSWORD 'rls-check'`,
      );
    }
    await owner.query(`GRANT workia_app TO ${ROLE}`);
    await owner.end();

    const url = new URL(database.url);
    url.username = ROLE;
    url.password = "rls-check";
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
    await database?.drop();
  });

  it("returns no business rows when the transaction set no company", async () => {
    expect(await asApp(null, "SELECT nombres FROM people")).toEqual([]);
  });

  it("returns only the rows of the company the transaction set", async () => {
    expect(await asApp(A, "SELECT nombres FROM people")).toEqual([
      { nombres: "Ana" },
    ]);
    expect(await asApp(B, "SELECT nombres FROM people")).toEqual([
      { nombres: "Beto" },
    ]);
  });

  it("refuses writing a row into another company", async () => {
    await expect(
      asApp(
        A,
        `INSERT INTO people (company_id, nombres, apellido_paterno) VALUES ('${B}', 'Intrusa', 'X')`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await asApp(
        A,
        `UPDATE people SET nombres = 'X' WHERE company_id = '${B}' RETURNING id`,
      ),
    ).toEqual([]);
  });

  it("keeps the owner (migrations, scripts) outside RLS", async () => {
    expect(
      await database.query("SELECT count(*)::int AS n FROM people"),
    ).toEqual([{ n: 2 }]);
  });

  it("covers every table with company_id: RLS on and its isolation policy", async () => {
    const tables = await database.query<{
      table: string;
      rls: boolean;
      policy: string | null;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, p.policyname AS policy
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = c.relname || '_company_isolation'
      WHERE col.table_schema = 'public' AND col.column_name = 'company_id'
        AND c.relname <> 'company_memberships'
      ORDER BY 1`);

    // 14 business tables (0018) + 5 MCP tables (0009_mcp) + person_beneficiaries
    // (0019) + regions (0022) + onboardings (0024) + people_views (0026).
    expect(tables.length).toBe(23);
    for (const table of tables) {
      expect(table, table.table).toMatchObject({
        rls: true,
        policy: `${table.table}_company_isolation`,
      });
    }
  });
});
