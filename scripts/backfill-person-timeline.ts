/**
 * Backfill of the person timeline (Workia 2.0 W2-13): person_events from
 * employment_periods, vacation_records, person_documents and the audit events
 * of a person whose puesto, sucursal, área or jefe changed. Idempotent: the
 * keys are the ones the app writes, so a second run inserts nothing.
 *
 *   npm run db:backfill-person-timeline                 # dry run (default)
 *   npm run db:backfill-person-timeline -- --apply      # write it
 *   ... -- --company <slug>                             # one company only
 *
 * Run as the database owner after `npm run db:migrate`. A database that is
 * not on this machine also needs --confirm-host <hostname>. Only Jorge runs
 * it against production.
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

const main = async () => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const { hostname } = new URL(url);
  const confirmIndex = process.argv.indexOf("--confirm-host");
  const confirmed =
    confirmIndex !== -1 && process.argv[confirmIndex + 1] === hostname;

  if (!LOCAL_HOSTS.includes(hostname) && !confirmed) {
    throw new Error(
      `DATABASE_URL points to ${hostname}, which is not local. Pass --confirm-host ${hostname} if that is intended.`,
    );
  }

  // Imported after dotenv: static imports are hoisted and would validate env first.
  const { backfillPersonTimeline } = await import("@/lib/timeline/backfill");
  const companyId = process.argv.includes("--company")
    ? await (
        await import("@/lib/tenant/companies")
      ).companyIdFromArgs(process.argv)
    : undefined;
  const report = await backfillPersonTimeline({
    apply: process.argv.includes("--apply"),
    companyId,
  });

  console.log(
    `Person timeline backfill (${report.applied ? "applied" : "dry run; pass --apply to write"}), ${report.companies} company(ies):`,
  );

  for (const [kind, count] of Object.entries(report.counts)) {
    console.log(
      `  ${kind}: ${count.source} in the source tables, ${count.inserted} ${report.applied ? "inserted" : "to insert"}, ${count.stored} stored`,
    );
  }

  if (report.applied) {
    console.log(
      report.matches
        ? "Counts match the source tables."
        : "Counts do NOT match the source tables.",
    );

    if (!report.matches) process.exitCode = 1;
  }
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
