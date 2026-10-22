/**
 * Backfill of employment periods (Iniciativa 2, migration 0025): one period
 * per person from people.fecha_ingreso; for a baja, the fecha de baja is
 * inferred from the last `baja` audit event, else the end of the last
 * contract, else it is left «sin fecha» for manual review. Idempotent.
 *
 *   npm run db:backfill-employment-periods                 # dry run (default)
 *   npm run db:backfill-employment-periods -- --apply      # write it
 *   ... -- --company <slug>                                # one company only
 *
 * Run after `npm run db:migrate`. Only Jorge runs it against production.
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

const parseCliOptions = () => {
  const args = process.argv.slice(2);

  return {
    apply: args.includes("--apply"),
    company: args.includes("--company"),
  };
};

const runCli = async () => {
  const options = parseCliOptions();
  const { backfillEmploymentPeriods } =
    await import("@/lib/people/employment-backfill");
  const companyId = options.company
    ? await (
        await import("@/lib/tenant/companies")
      ).companyIdFromArgs(process.argv)
    : undefined;
  const report = await backfillEmploymentPeriods({
    apply: options.apply,
    companyId,
  });

  console.log(
    [
      `Employment periods backfill (${report.applied ? "applied" : "dry run; pass --apply to write"}):`,
      `  people without a period: ${report.people}`,
      `  open (activa): ${report.open}`,
      `  baja dated from the audit log: ${report.closedFromAudit}`,
      `  baja dated from the last contract: ${report.closedFromContract}`,
      `  baja «sin fecha» (review): ${report.closedSinFecha}`,
      `  without fecha de ingreso (review): ${report.sinIngreso}`,
      `  altas linked to their period: ${report.onboardingsLinked}`,
    ].join("\n"),
  );
};

if (process.argv[1]?.includes("backfill-employment-periods")) {
  runCli()
    // Exit now: an idle local Postgres pool would keep the process alive ~10 s.
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Employment periods backfill failed:", error);
      process.exit(1);
    });
}
