import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase, repositoryMigrations } from "@/test/db/scratch";

import { migrationsThrough } from "./registry";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const all = repositoryMigrations();
const companiesMigration = all.find((m) => m.tag === "0015_companies")!;

describe("0015_companies: user_roles become memberships of the default company", () => {
  let database: Scratch;

  beforeAll(async () => {
    database = await createScratchDatabase(
      "m0015",
      migrationsThrough(all, "0014"),
    );

    await database.query(`
      INSERT INTO roles (slug, name) VALUES
        ('super_admin', 'Super Admin'), ('admin', 'Admin'), ('editor', 'Editor'), ('viewer', 'Viewer');
      INSERT INTO users (email, name) VALUES
        ('root@x.test', 'Root'), ('ana@x.test', 'Ana'), ('beto@x.test', 'Beto'),
        ('multi@x.test', 'Multi'), ('nobody@x.test', 'Nobody');
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u JOIN roles r ON
        (u.email = 'root@x.test' AND r.slug = 'super_admin') OR
        (u.email = 'ana@x.test' AND r.slug = 'admin') OR
        (u.email = 'beto@x.test' AND r.slug = 'viewer') OR
        (u.email = 'multi@x.test' AND r.slug IN ('viewer', 'editor'));
    `);

    await database.migrate([companiesMigration]);
  });

  afterAll(async () => {
    await database?.drop();
  });

  const memberships = () =>
    database.query<{
      email: string;
      role: string;
      company: string;
      status: string;
      is_default: boolean;
    }>(`
      SELECT u.email, r.slug AS role, c.slug AS company, m.status, m.is_default
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id
      JOIN companies c ON c.id = m.company_id
      ORDER BY u.email`);

  it("creates exactly one default company", async () => {
    expect(
      await database.query("SELECT name, slug, status FROM companies"),
    ).toEqual([
      {
        name: "Ferretera Mandiola",
        slug: "ferretera-mandiola",
        status: "activa",
      },
    ]);
  });

  it("gives every user with a role an active default membership with that role", async () => {
    expect(await memberships()).toEqual([
      {
        email: "ana@x.test",
        role: "admin",
        company: "ferretera-mandiola",
        status: "activa",
        is_default: true,
      },
      {
        email: "beto@x.test",
        role: "viewer",
        company: "ferretera-mandiola",
        status: "activa",
        is_default: true,
      },
      // Several global roles: the broadest one wins.
      {
        email: "multi@x.test",
        role: "editor",
        company: "ferretera-mandiola",
        status: "activa",
        is_default: true,
      },
      {
        email: "root@x.test",
        role: "super_admin",
        company: "ferretera-mandiola",
        status: "activa",
        is_default: true,
      },
    ]);
  });

  it("makes super_admins platform admins and nobody else", async () => {
    expect(
      await database.query(
        "SELECT email FROM users WHERE is_platform_admin ORDER BY email",
      ),
    ).toEqual([{ email: "root@x.test" }]);
  });

  it("refuses a second membership of the same user in the same company", async () => {
    await expect(
      database.query(`
        INSERT INTO company_memberships (user_id, company_id, role_id)
        SELECT m.user_id, m.company_id, m.role_id FROM company_memberships m LIMIT 1`),
    ).rejects.toThrow(/company_memberships_user_company_unique/);
  });

  it("can run again without changing anything", async () => {
    const before = await memberships();

    for (const statement of companiesMigration.statements) {
      await database.query(statement);
    }

    expect(await memberships()).toEqual(before);
    expect(
      await database.query("SELECT count(*)::int AS n FROM companies"),
    ).toEqual([{ n: 1 }]);
  });
});
