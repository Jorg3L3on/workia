/**
 * Local e2e fixture for the expediente «Credencial» (e2e/expediente-credencial.spec.ts).
 * Fictional data only; refuses a non-local DATABASE_URL.
 *
 *   npx tsx e2e/fixtures/expediente-credencial.ts people-only-user
 *     A role with people:read alone (no contracts, resguardo, audit or
 *     compensation) and a demo user with it in the demo company.
 *   npx tsx e2e/fixtures/expediente-credencial.ts set-baja <personId>
 *     Puts a demo-company person on baja without the dialog, so the spec
 *     does not depend on how «Dar de baja» asks for its data. It goes through
 *     the domain (setPersonStatus → terminatePerson), so the employment
 *     period is closed too: baja today, «Despido», the first motivo of the
 *     catalog, no recontratable and a pending finiquito of $4,321.50.
 *     e2e/personas-filtros.spec.ts uses it too, for a baja to filter on.
 *   npx tsx e2e/fixtures/expediente-credencial.ts hard-delete <personId>
 *     Removes a demo-company dummy (and its periods) the spec created, even
 *     when the spec failed before it could delete it from the UI.
 */
import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });
config();

const PEOPLE_ONLY_ROLE = "e2e_people_only";
const PEOPLE_ONLY_EMAIL = "solo-personas@workia.local";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const main = async () => {
  const hostname = new URL(
    process.env.DATABASE_URL ?? "postgresql://x@localhost/x",
  ).hostname;

  if (!LOCAL_HOSTS.includes(hostname)) {
    throw new Error(`Refusing to write e2e fixtures to ${hostname}.`);
  }

  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { companyMemberships, permissions, rolePermissions, roles, users } =
    await import("@/lib/db/schema");
  const { DEMO_PASSWORD } = await import("@/lib/db/schema/types");
  const { DEMO_COMPANY, ensureCompany } =
    await import("@/lib/tenant/companies");

  const company = await ensureCompany(DEMO_COMPANY);
  const [command, argument] = process.argv.slice(2);

  if (command === "set-baja" && argument) {
    const { setPersonStatus } = await import("@/lib/people");
    const { listTerminationReasons } =
      await import("@/lib/termination-reasons");
    const { isoToday } = await import("@/lib/format/date");
    const [reason] = await listTerminationReasons(company.id, {
      activeOnly: true,
    });

    if (!reason) {
      throw new Error("The demo company has no active motivo de baja.");
    }

    const result = await setPersonStatus(company.id, argument, {
      status: "baja",
      fechaBaja: isoToday(),
      tipoBaja: "despido",
      motivoBajaId: reason.id,
      comentario: "Baja de prueba e2e",
      recontratable: false,
      finiquito: { estado: "pendiente", monto: 4321.5 },
    });

    if (!result) {
      throw new Error(`No demo-company person ${argument}.`);
    }
    return;
  }

  if (command === "hard-delete" && argument) {
    const { and } = await import("drizzle-orm");
    const { people } = await import("@/lib/db/schema");

    await db
      .delete(people)
      .where(and(eq(people.companyId, company.id), eq(people.id, argument)));
    return;
  }

  if (command !== "people-only-user") {
    throw new Error(
      "Usage: people-only-user | set-baja <personId> | hard-delete <personId>",
    );
  }

  await db
    .insert(roles)
    .values({
      slug: PEOPLE_ONLY_ROLE,
      name: "E2E solo personas",
      description: "e2e: people:read only",
    })
    .onConflictDoNothing({ target: roles.slug });

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, PEOPLE_ONLY_ROLE));
  const [peopleRead] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.slug, "people:read"));

  await db
    .insert(rolePermissions)
    .values({ roleId: role.id, permissionId: peopleRead.id })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      email: PEOPLE_ONLY_EMAIL,
      name: "Solo Personas Demo",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
    })
    .onConflictDoNothing({ target: users.email });

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, PEOPLE_ONLY_EMAIL));

  await db
    .insert(companyMemberships)
    .values({
      userId: user.id,
      companyId: company.id,
      roleId: role.id,
      isDefault: true,
    })
    .onConflictDoUpdate({
      target: [companyMemberships.userId, companyMemberships.companyId],
      set: { roleId: role.id, status: "activa", isDefault: true },
    });
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
