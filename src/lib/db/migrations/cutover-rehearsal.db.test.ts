/**
 * Rehearsal of the multi-company cutover (WRK-I4-17) on a single-company
 * database at migration 0014: snapshot counts, apply 0015-0018, verify with
 * the same checks the production procedure uses, then roll back with
 * scripts/cutover/rollback.sql and prove the schema is the 0014 one again.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase, repositoryMigrations } from "@/test/db/scratch";

import { countRows, verifyCutover } from "../../../../scripts/cutover/checks";
import {
  DUPLICATE_CHECKS,
  duplicateQuery,
} from "../../../../scripts/report-duplicates";
import { migrationsThrough } from "./registry";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const all = repositoryMigrations();
const through0014 = migrationsThrough(all, "0014");
const cutover = all.filter((m) => /^001[5-8]_/.test(m.tag));
const rollbackSql = readFileSync(
  path.join(process.cwd(), "scripts/cutover/rollback.sql"),
  "utf8",
);

/** Columns, indexes, constraints, policies, types and functions of public, sorted. */
const fingerprint = async (database: Scratch) => {
  const lists = await Promise.all([
    database.query(`SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS d
      FROM information_schema.columns WHERE table_schema = 'public'`),
    database.query(
      `SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'public'`,
    ),
    database.query(`SELECT conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS d
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace`),
    database.query(
      `SELECT tablename || ' ' || policyname AS d FROM pg_policies WHERE schemaname = 'public'`,
    ),
    database.query(`SELECT relname || ' rls=' || relrowsecurity AS d FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`),
    database.query(
      `SELECT typname AS d FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e'`,
    ),
    database.query(
      `SELECT proname AS d FROM pg_proc WHERE pronamespace = 'public'::regnamespace`,
    ),
  ]);

  return lists.map((rows) => rows.map((row) => String(row.d)).sort());
};

describe("cutover rehearsal: single company → multi-company → rollback", () => {
  let database: Scratch;
  let pristine: Scratch;
  let before: Record<string, number>;

  beforeAll(async () => {
    pristine = await createScratchDatabase("rehearsal_pristine", through0014);
    database = await createScratchDatabase("rehearsal", through0014);

    // A small production-like dataset at 0014, before multi-company.
    await database.query(`
      INSERT INTO roles (slug, name) VALUES ('super_admin','Super Admin'),('admin','Admin'),('editor','Editor'),('viewer','Viewer');
      INSERT INTO users (email, name) VALUES ('jorge@x.test','Jorge'),('rrhh@x.test','RRHH'),('lectura@x.test','Lectura'),('sinrol@x.test','Sin rol');
      INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u JOIN roles r ON
        (u.email='jorge@x.test' AND r.slug IN ('super_admin','admin')) OR (u.email='rrhh@x.test' AND r.slug='admin') OR (u.email='lectura@x.test' AND r.slug='viewer');
      INSERT INTO areas (name) VALUES ('Ventas'), ('Almacén');
      INSERT INTO positions (name, area_id) SELECT 'Vendedor', id FROM areas WHERE name = 'Ventas';
      INSERT INTO activities (name) VALUES ('Atender'), ('Cobrar');
      INSERT INTO position_activities (position_id, activity_id) SELECT p.id, a.id FROM positions p, activities a;
      INSERT INTO sites (name, kind) VALUES ('Matriz', 'corporativo'), ('Centro', 'sucursal');
      INSERT INTO people (nombres, apellido_paterno, curp, rfc, nss, area_id, position_id, site_id)
        SELECT 'Persona ' || g, 'Prueba', 'CURP' || lpad(g::text, 14, '0'), 'RFC' || lpad(g::text, 10, '0'), lpad(g::text, 11, '0'),
               (SELECT id FROM areas WHERE name='Ventas'), (SELECT id FROM positions LIMIT 1), (SELECT id FROM sites WHERE name='Centro')
        FROM generate_series(1, 50) g;
      UPDATE people SET manager_id = (SELECT id FROM people WHERE nombres = 'Persona 1') WHERE nombres <> 'Persona 1';
      INSERT INTO person_schedules (person_id, entrada) SELECT id, '09:00' FROM people LIMIT 20;
      INSERT INTO contract_templates (name, body) VALUES ('Base', 'Contrato de {{nombres}}');
      INSERT INTO contracts (person_id, type, start_date, end_date, generated_text, template_id)
        SELECT id, 'determinado', '2026-01-01', '2026-12-31', 'x', (SELECT id FROM contract_templates LIMIT 1) FROM people;
      INSERT INTO assets (name, identifier, category, holder_id, status) SELECT 'Equipo', 'EQ-' || nombres, 'laptop', id, 'asignado' FROM people LIMIT 10;
      INSERT INTO asset_movements (asset_id, type, person_id, movement_date, condition_note) SELECT id, 'entrega', holder_id, '2026-01-02', 'ok' FROM assets;
      INSERT INTO audit_events (resource_type, resource_id, action) SELECT 'person', id::text, 'create' FROM people;
      INSERT INTO import_jobs (file_name, file_hash, status) VALUES ('p.xlsx', 'h', 'applied');
      INSERT INTO import_rows (job_id, sheet, row_number, raw, target_person_id)
        SELECT (SELECT id FROM import_jobs LIMIT 1), 'personas', row_number() over () + 1, '{}', id FROM people LIMIT 5;
    `);

    before = await countRows({
      query: async (text, params) => ({
        rows: await database.query(text, params),
      }),
    });
  });

  afterAll(async () => {
    await database?.drop();
    await pristine?.drop();
  });

  const client = () => ({
    query: async (text: string, params?: unknown[]) => ({
      rows: await database.query(text, params),
    }),
  });

  it("reports duplicates on the single-company schema, before migrating", async () => {
    const find = async () => {
      const found: string[] = [];
      for (const check of DUPLICATE_CHECKS) {
        for (const row of await database.query(duplicateQuery(check, false))) {
          found.push(`${check.label}:${row.key}`);
        }
      }
      return found;
    };

    expect(await find()).toEqual([]);
    await database.query(`INSERT INTO areas (name) VALUES ('  VENTAS ')`);
    expect(await find()).toEqual(["Área:ventas"]);
    await database.query(`DELETE FROM areas WHERE name = '  VENTAS '`);
  });

  it("applies 0015-0018 and passes the production checks", async () => {
    expect(await database.migrate(cutover)).toEqual(cutover.map((m) => m.tag));
    expect((await verifyCutover(client(), before)).problems).toEqual([]);
  });

  it("refuses to roll back once a second company exists", async () => {
    await database.query(
      `INSERT INTO companies (name, slug) VALUES ('Otra', 'otra')`,
    );
    await expect(database.query(rollbackSql)).rejects.toThrow(
      /More than one company/,
    );
    await database.query(`DELETE FROM companies WHERE slug = 'otra'`);
  });

  it("rolls back to exactly the 0014 schema, keeping every row", async () => {
    await database.query(rollbackSql);

    expect(await fingerprint(database)).toEqual(await fingerprint(pristine));
    expect(await countRows(client())).toEqual(before);
    expect(
      await database.query(
        `SELECT tag FROM drizzle.applied_migrations WHERE tag LIKE '001_\\_%' AND tag >= '0015'`,
      ),
    ).toEqual([]);
  });

  it("can migrate forward again after the rollback", async () => {
    expect(await database.migrate(cutover)).toEqual(cutover.map((m) => m.tag));
    expect((await verifyCutover(client(), before)).problems).toEqual([]);
  });
});
