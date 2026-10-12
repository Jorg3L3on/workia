/**
 * Lists active people that share a CURP or RFC (after normalization), so they
 * can be merged or corrected before the unique indexes of migration 0010.
 *
 *   npm run db:report-identity-duplicates
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

type Row = { id: string; name: string; value: string };

const groupDuplicates = (rows: Row[]) => {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    groups.set(row.value, [...(groups.get(row.value) ?? []), row]);
  }

  return [...groups.entries()].filter(([, members]) => members.length > 1);
};

const main = async () => {
  // Imported after dotenv: static imports are hoisted and would validate env first.
  const { isNull } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { people } = await import("@/lib/db/schema");
  const { identifierOrNull } = await import("@/lib/people/identity");

  const active = await db.select().from(people).where(isNull(people.deletedAt));
  let total = 0;

  for (const field of ["curp", "rfc"] as const) {
    const rows = active.flatMap((person) => {
      const value = identifierOrNull(person[field]);

      return value
        ? [
            {
              id: person.id,
              name: `${person.nombres} ${person.apellidoPaterno}`,
              value,
            },
          ]
        : [];
    });

    for (const [value, members] of groupDuplicates(rows)) {
      total += 1;
      console.log(`${field.toUpperCase()} ${value}`);
      for (const member of members) {
        console.log(`  - ${member.id}  ${member.name}`);
      }
    }
  }

  console.log(
    total === 0
      ? "Sin duplicados activos."
      : `${total} identificador(es) duplicado(s).`,
  );
  process.exit(total === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
