/**
 * Lists active rows that would break the per-company unique indexes of
 * migration 0017 (WRK-I4-5): CURP, RFC and NSS of people, catalog names
 * (areas, positions, sites, activities, compared like the importer does,
 * without case or accents) and asset identifiers. Resolve every group before
 * applying the migration; it refuses to run while any remain.
 *
 *   npm run db:report-duplicates
 *
 * Exit code 0 when clean, 1 when there are duplicates.
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

// SQL twin of catalogKey() in src/lib/import/format.ts (the migration defines
// the same expression as catalog_key()).
const CATALOG_KEY = (column: string) =>
  `btrim(regexp_replace(translate(lower(${column}), 'áàäâãåéèëêíìïîóòöôõúùüûñçý', 'aaaaaaeeeeiiiiooooouuuuncy'), '\\s+', ' ', 'g'))`;

export const DUPLICATE_CHECKS = [
  {
    label: "CURP",
    table: "people",
    key: "curp",
    name: "nombres || ' ' || apellido_paterno",
  },
  {
    label: "RFC",
    table: "people",
    key: "rfc",
    name: "nombres || ' ' || apellido_paterno",
  },
  {
    label: "NSS",
    table: "people",
    key: "nss",
    name: "nombres || ' ' || apellido_paterno",
  },
  { label: "Área", table: "areas", key: CATALOG_KEY("name"), name: "name" },
  {
    label: "Puesto",
    table: "positions",
    key: CATALOG_KEY("name"),
    name: "name",
  },
  { label: "Sucursal", table: "sites", key: CATALOG_KEY("name"), name: "name" },
  {
    label: "Actividad",
    table: "activities",
    key: CATALOG_KEY("name"),
    name: "name",
  },
  {
    label: "Identificador de activo",
    table: "assets",
    key: "identifier",
    name: "name",
  },
] as const;

/**
 * One query per check: duplicated keys per company among live rows. Before
 * migration 0016 there is no company_id yet: the whole database is one company.
 */
export const duplicateQuery = (
  check: (typeof DUPLICATE_CHECKS)[number],
  hasCompanies = true,
) =>
  hasCompanies
    ? `
  select c.slug as company, d.key, d.ids, d.names
  from (
    select company_id, ${check.key} as key,
           array_agg(id::text order by id) as ids,
           array_agg(${check.name} order by id) as names
    from "${check.table}"
    where deleted_at is null and ${check.key} is not null
    group by company_id, ${check.key}
    having count(*) > 1
  ) d
  join companies c on c.id = d.company_id
  order by c.slug, d.key`
    : `
  select 'única' as company, ${check.key} as key,
         array_agg(id::text order by id) as ids,
         array_agg(${check.name} order by id) as names
  from "${check.table}"
  where deleted_at is null and ${check.key} is not null
  group by ${check.key}
  having count(*) > 1
  order by 2`;

const main = async () => {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let total = 0;

  try {
    const { rows: columns } = await client.query(
      `select 1 from information_schema.columns where table_name = 'people' and column_name = 'company_id'`,
    );
    const hasCompanies = columns.length > 0;

    for (const check of DUPLICATE_CHECKS) {
      const { rows } = await client.query<{
        company: string;
        key: string;
        ids: string[];
        names: string[];
      }>(duplicateQuery(check, hasCompanies));

      for (const row of rows) {
        total += 1;
        console.log(`[${row.company}] ${check.label} "${row.key}"`);
        row.ids.forEach((id, index) =>
          console.log(`  - ${id}  ${row.names[index]}`),
        );
      }
    }
  } finally {
    await client.end();
  }

  console.log(
    total === 0
      ? "Sin duplicados activos."
      : `${total} valor(es) duplicado(s).`,
  );
  process.exit(total === 0 ? 0 : 1);
};

if (process.argv[1]?.includes("report-duplicates")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
