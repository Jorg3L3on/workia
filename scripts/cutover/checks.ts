/**
 * Checks for the multi-company cutover (WRK-I4-17), shared by the CLI
 * (scripts/cutover/run.ts) and the rehearsal test. They only read.
 */

export type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Business tables that get company_id in migration 0016. */
export const BUSINESS_TABLES = [
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
] as const;

/** Row counts of the business tables plus users and user_roles. */
export const countRows = async (client: Queryable) => {
  const counts: Record<string, number> = {};

  for (const table of [...BUSINESS_TABLES, "users", "user_roles"]) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${table}"`,
    );
    counts[table] = Number(rows[0].n);
  }

  return counts;
};

/**
 * After migrating: what must hold, as a list of problems (empty = ready).
 * `before` are the counts taken before applying 0015-0018.
 */
export const verifyCutover = async (
  client: Queryable,
  before: Record<string, number>,
  defaultSlug = "ferretera-mandiola",
) => {
  const problems: string[] = [];
  const after = await countRows(client);

  // Audit rows only grow (the app may write while you verify).
  for (const [table, count] of Object.entries(before)) {
    const now = after[table];
    const ok = table === "audit_events" ? now >= count : now === count;
    if (!ok) problems.push(`${table}: ${count} rows before, ${now} after`);
  }

  const { rows: companies } = await client.query(
    `SELECT id FROM companies WHERE slug = $1`,
    [defaultSlug],
  );

  if (companies.length !== 1) {
    problems.push(`default company "${defaultSlug}" not found`);
    return { problems, after };
  }

  for (const table of BUSINESS_TABLES) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${table}" WHERE company_id IS NULL`,
    );
    if (Number(rows[0].n) > 0)
      problems.push(`${table}: ${rows[0].n} rows without company_id`);
  }

  // Every user who had a role keeps it as a membership of the default company.
  const { rows: missing } = await client.query(
    `SELECT u.email FROM users u
     WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM company_memberships m
         WHERE m.user_id = u.id AND m.company_id = $1 AND m.status = 'activa'
       )`,
    [companies[0].id],
  );
  for (const row of missing)
    problems.push(`user ${row.email} has a role but no membership`);

  const { rows: lostAdmins } = await client.query(
    `SELECT u.email FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.slug = 'super_admin'
     WHERE NOT u.is_platform_admin`,
  );
  for (const row of lostAdmins)
    problems.push(`super_admin ${row.email} is not a platform admin`);

  const { rows: rls } = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT c.relrowsecurity`,
    [BUSINESS_TABLES],
  );
  for (const row of rls)
    problems.push(`${row.relname}: row-level security is off`);

  return { problems, after };
};
