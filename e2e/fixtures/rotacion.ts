/**
 * Local e2e fixture for the turnover report (e2e/reportes-rotacion.spec.ts).
 * Fictional data only; refuses a non-local DATABASE_URL.
 *
 *   npx tsx e2e/fixtures/rotacion.ts create-baja <apellido>
 *     A demo-company person hired 60 days ago and given de baja today through
 *     the domain (a salida en prueba), with the first motivo of the catalog.
 *     Prints the person id.
 *   npx tsx e2e/fixtures/rotacion.ts hard-delete <personId>
 *     Removes that person (and the period) even when the spec failed.
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
  const { people } = await import("@/lib/db/schema");
  const { DEMO_COMPANY, ensureCompany } =
    await import("@/lib/tenant/companies");
  const company = await ensureCompany(DEMO_COMPANY);
  const [command, argument] = process.argv.slice(2);

  if (command === "create-baja" && argument) {
    const { createPerson } = await import("@/lib/people");
    const { terminatePerson } = await import("@/lib/people/employment");
    const { listTerminationReasons } =
      await import("@/lib/termination-reasons");
    const { addDays } = await import("@/lib/reports/turnover/dates");
    const { isoToday } = await import("@/lib/format/date");
    const today = isoToday();
    const [reason] = await listTerminationReasons(company.id, {
      activeOnly: true,
    });
    const person = await createPerson(company.id, {
      nombres: "Rotación",
      apellidoPaterno: argument,
      apellidoMaterno: "",
      email: "",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: addDays(today, -60),
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      horarioEntrada: "",
      horarioSalidaComer: "",
      horarioRegresoComer: "",
      horarioSalida: "",
      status: "activa",
    });

    await terminatePerson(company.id, person.id, {
      fechaBaja: today,
      tipoBaja: "termino_contrato",
      motivoBajaId: reason.id,
      recontratable: false,
    });
    console.log(person.id);
    return;
  }

  if (command === "hard-delete" && argument) {
    await db
      .delete(people)
      .where(and(eq(people.companyId, company.id), eq(people.id, argument)));
    return;
  }

  throw new Error("Usage: create-baja <apellido> | hard-delete <personId>");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
