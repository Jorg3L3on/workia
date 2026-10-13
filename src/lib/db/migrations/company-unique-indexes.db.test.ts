import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase } from "@/test/db/scratch";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const A = "00000000-0000-0000-0000-0000000000a0";
const B = "00000000-0000-0000-0000-0000000000b0";

describe("0017: uniqueness and indexes per company", () => {
  let database: Scratch;

  beforeAll(async () => {
    database = await createScratchDatabase("m0017");
    await database.query(`
      INSERT INTO companies (id, name, slug) VALUES ('${A}', 'A', 'a'), ('${B}', 'B', 'b');`);
  });

  afterAll(async () => {
    await database?.drop();
  });

  const person = (company: string, curp: string, rfc: string, nss: string) =>
    database.query(`
      INSERT INTO people (company_id, nombres, apellido_paterno, curp, rfc, nss)
      VALUES ('${company}', 'Ana', 'Uno', '${curp}', '${rfc}', '${nss}')`);

  it("lets the same CURP, RFC and NSS live in two companies but not twice in one", async () => {
    await person(A, "CURP000000000000A1", "RFC0000000A1", "11111111111");
    await person(B, "CURP000000000000A1", "RFC0000000A1", "11111111111");

    await expect(
      person(A, "CURP000000000000A1", "RFC0000000X1", "00000000001"),
    ).rejects.toThrow(/people_company_curp_active_unique/);
    await expect(
      person(A, "CURP000000000000X2", "RFC0000000A1", "00000000002"),
    ).rejects.toThrow(/people_company_rfc_active_unique/);
    await expect(
      person(A, "CURP000000000000X3", "RFC0000000X3", "11111111111"),
    ).rejects.toThrow(/people_company_nss_active_unique/);
  });

  it("frees the identifier once the holder is soft-deleted", async () => {
    await database.query(
      `UPDATE people SET deleted_at = now() WHERE company_id = '${A}'`,
    );
    await person(A, "CURP000000000000A1", "RFC0000000A1", "11111111111");
  });

  it("compares catalog names like the importer: case, accents and spaces do not count", async () => {
    await database.query(
      `INSERT INTO areas (company_id, name) VALUES ('${A}', 'Logística')`,
    );
    await database.query(
      `INSERT INTO areas (company_id, name) VALUES ('${B}', 'Logística')`,
    );

    for (const [table, name] of [
      ["areas", "  LOGISTICA "],
      ["areas", "logística"],
    ]) {
      await expect(
        database.query(
          `INSERT INTO ${table} (company_id, name) VALUES ('${A}', '${name}')`,
        ),
      ).rejects.toThrow(/areas_company_name_active_unique/);
    }

    for (const table of ["positions", "activities"]) {
      await database.query(
        `INSERT INTO ${table} (company_id, name) VALUES ('${A}', 'Cajero')`,
      );
      await expect(
        database.query(
          `INSERT INTO ${table} (company_id, name) VALUES ('${A}', 'CAJERO')`,
        ),
      ).rejects.toThrow(new RegExp(`${table}_company_name_active_unique`));
    }

    await database.query(
      `INSERT INTO sites (company_id, name, kind) VALUES ('${A}', 'Centro', 'sucursal')`,
    );
    await expect(
      database.query(
        `INSERT INTO sites (company_id, name, kind) VALUES ('${A}', 'centro', 'sucursal')`,
      ),
    ).rejects.toThrow(/sites_company_name_active_unique/);
  });

  it("keeps asset identifiers unique per company", async () => {
    const asset = (company: string) =>
      database.query(`
        INSERT INTO assets (company_id, name, identifier, category)
        VALUES ('${company}', 'Laptop', 'LP-1', 'equipo')`);

    await asset(A);
    await asset(B);
    await expect(asset(A)).rejects.toThrow(
      /assets_company_identifier_active_unique/,
    );
  });

  it("allows one import applying per company, two companies at once", async () => {
    const applying = (company: string) =>
      database.query(`
        INSERT INTO import_jobs (company_id, file_name, file_hash, status)
        VALUES ('${company}', 'p.xlsx', 'h', 'applying')`);

    await applying(A);
    await applying(B);
    await expect(applying(A)).rejects.toThrow(
      /import_jobs_single_applying_idx/,
    );
  });

  describe("with two companies of 1,000 people", () => {
    beforeAll(async () => {
      await database.query(`
        DELETE FROM people;
        INSERT INTO people (company_id, nombres, apellido_paterno, status, updated_at)
        SELECT c.id, 'Persona ' || g, 'Apellido ' || (g % 97), CASE WHEN g % 10 = 0 THEN 'baja'::person_status ELSE 'activa' END,
               now() - (g || ' minutes')::interval
        FROM (VALUES ('${A}'::uuid), ('${B}'::uuid)) c(id), generate_series(1, 1000) g;
        INSERT INTO contracts (company_id, person_id, type, start_date, end_date, generated_text, status)
        SELECT company_id, id, 'determinado', current_date - 200, current_date + (row_number() over ())::int % 400, 'x', 'vigente'
        FROM people;
        INSERT INTO assets (company_id, name, identifier, category, holder_id, status)
        SELECT company_id, 'Equipo ' || id, 'EQ-' || id, 'equipo', id, 'asignado' FROM people WHERE status = 'activa';
        INSERT INTO audit_events (company_id, resource_type, resource_id, action, occurred_at)
        SELECT company_id, 'person', id::text, 'update', now() - (random() * 1000 || ' hours')::interval FROM people;
        ANALYZE;`);
    });

    const plan = async (query: string) =>
      (await database.query<{ "QUERY PLAN": string }>(`EXPLAIN ${query}`))
        .map((row) => row["QUERY PLAN"])
        .join("\\n");

    it("lists a company's people through its company index", async () => {
      expect(
        await plan(`
          SELECT id FROM people WHERE company_id = '${A}' AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 50`),
      ).toMatch(/people_company_live_updated_idx/);
    });

    it("finds contracts to renew through the company renewal index", async () => {
      expect(
        await plan(`
          SELECT id FROM contracts WHERE company_id = '${A}' AND status = 'vigente'
            AND type = 'determinado' AND deleted_at IS NULL
            AND end_date BETWEEN current_date AND current_date + 30
          ORDER BY end_date`),
      ).toMatch(/contracts_company_renewal_end_date_idx/);
    });

    it("pages assets and audit events through their company indexes", async () => {
      expect(
        await plan(`
          SELECT id FROM assets WHERE company_id = '${A}' AND status = 'asignado' AND deleted_at IS NULL
          ORDER BY name LIMIT 50`),
      ).toMatch(/assets_company_status_name_idx/);
      expect(
        await plan(`
          SELECT id FROM audit_events WHERE company_id = '${A}' ORDER BY occurred_at DESC LIMIT 50`),
      ).toMatch(/audit_events_company_occurred_idx/);
    });
  });
});
