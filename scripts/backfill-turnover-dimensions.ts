/**
 * Backfill of the área, sucursal, puesto and jefe a closed employment period
 * keeps for the turnover report (WRK-I12, migration 0027), from the person as
 * they are now. Idempotent: a second run finds nothing.
 *
 *   npm run db:backfill-turnover-dimensions                 # dry run (default)
 *   npm run db:backfill-turnover-dimensions -- --apply      # write it
 *   ... -- --company <slug>                                 # one company only
 *
 * Run after `npm run db:migrate`. Only Jorge runs it against production.
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

const runCli = async () => {
  const args = process.argv.slice(2);
  const { backfillTurnoverDimensions } =
    await import("@/lib/people/employment-backfill");
  const companyId = args.includes("--company")
    ? await (
        await import("@/lib/tenant/companies")
      ).companyIdFromArgs(process.argv)
    : undefined;
  const report = await backfillTurnoverDimensions({
    apply: args.includes("--apply"),
    companyId,
  });

  console.log(
    `Turnover dimensions backfill (${report.applied ? "applied" : "dry run; pass --apply to write"}): ${report.periods} closed period(s) ${report.applied ? "updated" : "to update"}.`,
  );
};

if (process.argv[1]?.includes("backfill-turnover-dimensions")) {
  runCli()
    // Exit now: an idle local Postgres pool would keep the process alive ~10 s.
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Turnover dimensions backfill failed:", error);
      process.exit(1);
    });
}
