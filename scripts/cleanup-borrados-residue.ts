/**
 * Idempotent Borrados cleanup — dummy names only.
 *
 * Hard-deletes leftover TEST residue that is already soft-deleted
 * (e2e "Persona Borrada Demo" + suffix, Prueba, borrar-demo-suffix).
 * Keeps the official walkthrough expediente and never touches live
 * seed company people still in the active expediente.
 *
 * Shipper (after merge):
 *   npm run db:cleanup-borrados
 *   npm run db:seed
 */

import { config } from "dotenv";
import { and, eq, isNotNull } from "drizzle-orm";

config({ path: ".env.local" });
config();

import {
  OFFICIAL_DELETED_DEMO_FULL_NAME,
  OFFICIAL_DELETED_DEMO_PERSON,
  formatBorradosCleanupName,
  isSoftDeletedTestResidue,
  type BorradosCleanupPerson,
} from "@/lib/people/borrados-cleanup";

type NamedPerson = BorradosCleanupPerson & { id: string };

const parseCliOptions = () => {
  const args = process.argv.slice(2);
  const fullNameIndex = args.indexOf("--full-name");

  return {
    dryRun: args.includes("--dry-run"),
    fullName: fullNameIndex >= 0 ? (args[fullNameIndex + 1] ?? "").trim() : "",
  };
};

const hardDeletePersonCascade = async (
  personId: string,
  db: typeof import("@/lib/db").db,
  tables: typeof import("@/lib/db/schema"),
) => {
  const { assetMovements, assets, contracts, people } = tables;

  await db.delete(contracts).where(eq(contracts.personId, personId));
  await db.delete(assetMovements).where(eq(assetMovements.personId, personId));
  await db
    .update(assets)
    .set({ holderId: null, status: "disponible" })
    .where(eq(assets.holderId, personId));
  await db
    .update(people)
    .set({ managerId: null })
    .where(eq(people.managerId, personId));
  await db.delete(people).where(eq(people.id, personId));
};

export const cleanupBorradosResidue = async (
  options: { dryRun?: boolean; fullName?: string } = {},
) => {
  const { db } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { people } = schema;

  const rows = await db
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      email: people.email,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(isNotNull(people.deletedAt));

  const residue = rows.filter((row) => {
    if (!isSoftDeletedTestResidue(row)) {
      return false;
    }

    if (!options.fullName) {
      return true;
    }

    return formatBorradosCleanupName(row) === options.fullName;
  }) as NamedPerson[];

  if (residue.length === 0) {
    console.log("Borrados cleanup: no test residue to remove.");
    return { removed: 0, names: [] as string[] };
  }

  const names = residue.map((row) => formatBorradosCleanupName(row));

  if (options.dryRun) {
    console.log(
      `Borrados cleanup (dry-run): ${residue.length} residue row(s): ${names.join(", ")}`,
    );
    return { removed: 0, names };
  }

  for (const row of residue) {
    await hardDeletePersonCascade(row.id, db, schema);
  }

  console.log(
    `Borrados cleanup: hard-deleted ${residue.length} dummy residue row(s).`,
  );

  return { removed: residue.length, names };
};

export const ensureOfficialDeletedDemoPerson = async () => {
  const { recordAuditEvent } = await import("@/lib/audit");
  const { db } = await import("@/lib/db");
  const { areas, people } = await import("@/lib/db/schema");

  const [existing] = await db
    .select({
      id: people.id,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(
      and(
        eq(people.nombres, OFFICIAL_DELETED_DEMO_PERSON.nombres),
        eq(
          people.apellidoPaterno,
          OFFICIAL_DELETED_DEMO_PERSON.apellidoPaterno,
        ),
        eq(
          people.apellidoMaterno,
          OFFICIAL_DELETED_DEMO_PERSON.apellidoMaterno,
        ),
      ),
    )
    .limit(1);

  if (existing) {
    if (!existing.deletedAt) {
      const deletedAt = new Date();

      await db
        .update(people)
        .set({ deletedAt })
        .where(eq(people.id, existing.id));

      await recordAuditEvent({
        resourceType: "person",
        resourceId: existing.id,
        action: "delete",
        source: "seed",
        payload: {
          summary: "Borrado lógico del expediente demo de recorrido",
        },
      });

      console.log(
        `Official Borrados demo marked deleted: ${OFFICIAL_DELETED_DEMO_FULL_NAME}.`,
      );
      return existing.id;
    }

    console.log(
      `Official Borrados demo already present: ${OFFICIAL_DELETED_DEMO_FULL_NAME}.`,
    );
    return existing.id;
  }

  const [rrhh] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.name, "RRHH"))
    .limit(1);

  const today = new Date();
  const fechaIngreso = new Date(today);
  fechaIngreso.setDate(fechaIngreso.getDate() - 200);

  const [created] = await db
    .insert(people)
    .values({
      nombres: OFFICIAL_DELETED_DEMO_PERSON.nombres,
      apellidoPaterno: OFFICIAL_DELETED_DEMO_PERSON.apellidoPaterno,
      apellidoMaterno: OFFICIAL_DELETED_DEMO_PERSON.apellidoMaterno,
      email: OFFICIAL_DELETED_DEMO_PERSON.email,
      rfc: OFFICIAL_DELETED_DEMO_PERSON.rfc,
      curp: OFFICIAL_DELETED_DEMO_PERSON.curp,
      nss: OFFICIAL_DELETED_DEMO_PERSON.nss,
      status: "activa",
      areaId: rrhh?.id ?? null,
      fechaIngreso: fechaIngreso.toISOString().slice(0, 10),
      deletedAt: today,
    })
    .returning({ id: people.id });

  await recordAuditEvent({
    resourceType: "person",
    resourceId: created.id,
    action: "create",
    source: "seed",
    payload: {
      summary: `Expediente demo borrado: ${OFFICIAL_DELETED_DEMO_FULL_NAME}`,
    },
  });

  await recordAuditEvent({
    resourceType: "person",
    resourceId: created.id,
    action: "delete",
    source: "seed",
    payload: {
      summary: "Borrado lógico del expediente demo de recorrido",
    },
  });

  console.log(
    `Official Borrados demo created: ${OFFICIAL_DELETED_DEMO_FULL_NAME}.`,
  );

  return created.id;
};

const runCli = async () => {
  const options = parseCliOptions();
  await cleanupBorradosResidue(options);
  await ensureOfficialDeletedDemoPerson();
};

const invokedDirectly = process.argv[1]?.includes("cleanup-borrados-residue");

if (invokedDirectly) {
  runCli().catch((error) => {
    console.error("Borrados cleanup failed:", error);
    process.exit(1);
  });
}
