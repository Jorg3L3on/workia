import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase, repositoryMigrations } from "@/test/db/scratch";

import { migrationsThrough } from "./registry";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const TABLES = [
  "people",
  "person_schedules",
  "areas",
  "positions",
  "activities",
  "position_activities",
  "sites",
  "contracts",
  "contract_templates",
  "assets",
  "asset_movements",
  "audit_events",
  "import_jobs",
  "import_rows",
];

const all = repositoryMigrations();

const countRows = async (database: Scratch) => {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = await database.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${table}"`,
    );
    counts[table] = row.n;
  }
  return counts;
};

describe("0016_company_id: every business row gets the default company", () => {
  let database: Scratch;
  let before: Record<string, number>;

  beforeAll(async () => {
    database = await createScratchDatabase(
      "m0016",
      migrationsThrough(all, "0015"),
    );

    // One row in every table, linked the way the app links them.
    await database.query(`
      INSERT INTO users (id, email, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'a@x.test', 'A');
      INSERT INTO areas (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Ventas');
      INSERT INTO areas (id, name, parent_area_id) VALUES ('00000000-0000-0000-0000-000000000002', 'Mostrador', '00000000-0000-0000-0000-000000000001');
      INSERT INTO positions (id, name, area_id) VALUES ('00000000-0000-0000-0000-000000000003', 'Vendedor', '00000000-0000-0000-0000-000000000001');
      INSERT INTO activities (id, name) VALUES ('00000000-0000-0000-0000-000000000004', 'Atender');
      INSERT INTO position_activities (position_id, activity_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004');
      INSERT INTO sites (id, name, kind) VALUES ('00000000-0000-0000-0000-000000000005', 'Centro', 'sucursal');
      INSERT INTO people (id, nombres, apellido_paterno, area_id, position_id, site_id)
        VALUES ('00000000-0000-0000-0000-000000000006', 'Ana', 'Uno', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005');
      INSERT INTO people (id, nombres, apellido_paterno, manager_id)
        VALUES ('00000000-0000-0000-0000-000000000007', 'Beto', 'Dos', '00000000-0000-0000-0000-000000000006');
      INSERT INTO person_schedules (person_id, entrada) VALUES ('00000000-0000-0000-0000-000000000006', '09:00');
      INSERT INTO contract_templates (id, name, body) VALUES ('00000000-0000-0000-0000-000000000008', 'Base', 'Texto');
      INSERT INTO contracts (id, person_id, type, start_date, template_id, generated_text)
        VALUES ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000006', 'determinado', '2026-01-01', '00000000-0000-0000-0000-000000000008', 'x');
      INSERT INTO contracts (person_id, type, start_date, generated_text, previous_contract_id)
        VALUES ('00000000-0000-0000-0000-000000000006', 'determinado', '2026-07-01', 'y', '00000000-0000-0000-0000-000000000009');
      INSERT INTO assets (id, name, identifier, category, holder_id, status)
        VALUES ('00000000-0000-0000-0000-00000000000a', 'Laptop', 'LP-1', 'equipo', '00000000-0000-0000-0000-000000000006', 'asignado');
      INSERT INTO asset_movements (asset_id, type, person_id, movement_date, condition_note)
        VALUES ('00000000-0000-0000-0000-00000000000a', 'entrega', '00000000-0000-0000-0000-000000000006', '2026-01-02', 'nueva');
      INSERT INTO audit_events (actor_user_id, resource_type, resource_id, action)
        VALUES ('00000000-0000-0000-0000-0000000000a1', 'person', '00000000-0000-0000-0000-000000000006', 'create');
      INSERT INTO import_jobs (id, file_name, file_hash) VALUES ('00000000-0000-0000-0000-00000000000b', 'p.xlsx', 'h');
      INSERT INTO import_rows (job_id, sheet, row_number, raw, target_person_id, target_contract_id)
        VALUES ('00000000-0000-0000-0000-00000000000b', 'Personas', 2, '{}', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000009');
    `);

    before = await countRows(database);
    await database.migrate([all.find((m) => m.tag === "0016_company_id")!]);
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("keeps every row", async () => {
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    expect(await countRows(database)).toEqual(before);
  });

  it("leaves no row without a company, all in the default one", async () => {
    for (const table of TABLES) {
      const rows = await database.query<{ slug: string | null; n: number }>(`
        SELECT c.slug, count(*)::int AS n FROM "${table}" t LEFT JOIN companies c ON c.id = t.company_id GROUP BY c.slug`);
      expect(rows, table).toEqual([
        { slug: "ferretera-mandiola", n: before[table] },
      ]);
    }
  });

  describe("with a second company", () => {
    beforeAll(async () => {
      await database.query(`
        INSERT INTO companies (id, name, slug) VALUES ('00000000-0000-0000-0000-0000000000b2', 'Otra', 'otra');
        INSERT INTO contract_templates (id, company_id, name, body)
          VALUES ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', 'Ajena', 'Texto');`);
    });

    it("refuses a contract whose person belongs to another company", async () => {
      await expect(
        database.query(`
          INSERT INTO contracts (company_id, person_id, type, start_date, generated_text)
          VALUES ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000006', 'indeterminado', '2026-01-01', 'x')`),
      ).rejects.toThrow(/contracts_company_person_fk/);
    });

    it("refuses pointing a contract at another company's template", async () => {
      await expect(
        database.query(`
          UPDATE contracts SET template_id = '00000000-0000-0000-0000-0000000000b3'
          WHERE id = '00000000-0000-0000-0000-000000000009'`),
      ).rejects.toThrow(/contracts_company_template_fk/);
    });

    it("refuses a manager from another company", async () => {
      await database.query(`
        INSERT INTO people (id, company_id, nombres, apellido_paterno)
        VALUES ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b2', 'Ajeno', 'Tres')`);
      await expect(
        database.query(`
          UPDATE people SET manager_id = '00000000-0000-0000-0000-0000000000b4'
          WHERE id = '00000000-0000-0000-0000-000000000007'`),
      ).rejects.toThrow(/people_company_manager_fk/);
    });

    it("still nulls references when their target is hard-deleted, keeping the company", async () => {
      // Area 1 is the parent of area 2, the area of position 3 and of person 6.
      await database.query(`DELETE FROM position_activities`);
      await database.query(
        `DELETE FROM areas WHERE id = '00000000-0000-0000-0000-000000000001'`,
      );

      expect(
        await database.query(`
          SELECT (SELECT parent_area_id FROM areas WHERE id = '00000000-0000-0000-0000-000000000002') AS parent,
                 (SELECT area_id FROM positions WHERE id = '00000000-0000-0000-0000-000000000003') AS position_area,
                 (SELECT area_id FROM people WHERE id = '00000000-0000-0000-0000-000000000006') AS person_area,
                 (SELECT company_id IS NOT NULL FROM people WHERE id = '00000000-0000-0000-0000-000000000006') AS has_company`),
      ).toEqual([
        {
          parent: null,
          position_area: null,
          person_area: null,
          has_company: true,
        },
      ]);
    });
  });
});
