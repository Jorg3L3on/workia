/**
 * Local e2e fixture: an alta to open (e2e/hydration.spec.ts). The seed has
 * no altas, so the alta detail page would never be visited.
 * Fictional data only; refuses a non-local DATABASE_URL.
 *
 *   npx tsx e2e/fixtures/alta.ts start <suffix>
 *     A dummy «Persona Alta<suffix>» in the demo company and its alta (RH
 *     captura), started by the demo admin. Prints the person's id.
 *   npx tsx e2e/fixtures/alta.ts delete <personId>
 *     Hard-deletes that dummy; its periods and alta go with it.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const main = async () => {
  const hostname = new URL(
    process.env.DATABASE_URL ?? "postgresql://x@localhost/x",
  ).hostname;

  if (!LOCAL_HOSTS.includes(hostname)) {
    throw new Error(`Refusing to write e2e fixtures to ${hostname}.`);
  }

  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { people, users } = await import("@/lib/db/schema");
  const { DEMO_COMPANY, ensureCompany } =
    await import("@/lib/tenant/companies");

  const company = await ensureCompany(DEMO_COMPANY);
  const [command, argument] = process.argv.slice(2);

  if (command === "start" && argument) {
    const { startOnboarding } = await import("@/lib/onboarding");
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@workia.local"));
    const [person] = await db
      .insert(people)
      .values({
        companyId: company.id,
        nombres: "Persona",
        apellidoPaterno: `Alta${argument}`,
        status: "activa",
      })
      .returning({ id: people.id });

    await startOnboarding(company.id, person.id, admin.id);
    console.log(person.id);
    return;
  }

  if (command === "delete" && argument) {
    await db
      .delete(people)
      .where(and(eq(people.companyId, company.id), eq(people.id, argument)));
    return;
  }

  throw new Error("Usage: start <suffix> | delete <personId>");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
