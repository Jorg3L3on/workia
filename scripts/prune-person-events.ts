/**
 * The person timeline retention job (Workia 2.0 P-01): deletes person_events
 * rows older than RETENTION_YEARS (src/lib/timeline), in batches of people per
 * company. Run it as the database owner. Not scheduled yet: when and where it
 * runs (a Vercel cron or by hand) is Jorge's call, see docs/timeline.md.
 *
 *   npm run db:prune-person-events               delete what is past retention
 *
 * A database that is not on this machine also needs --confirm-host <hostname>.
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
  const { deleteExpiredPersonEvents } = await import("@/lib/timeline");
  const deleted = await deleteExpiredPersonEvents();

  for (const [type, count] of Object.entries(deleted)) {
    if (count > 0) {
      console.log(`${type}: deleted ${count}`);
    }
  }

  const total = Object.values(deleted).reduce((sum, count) => sum + count, 0);
  console.log(`Deleted ${total} person_events row(s) past retention.`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
