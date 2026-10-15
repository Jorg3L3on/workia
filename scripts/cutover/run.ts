/**
 * Multi-company cutover helper (WRK-I4-17). See docs/multiempresa.md.
 *
 *   npm run db:cutover -- snapshot --out counts.json [--confirm-host <host>]
 *   npm run db:cutover -- verify --counts counts.json [--confirm-host <host>]
 *
 * Read-only. A database that is not local needs --confirm-host <hostname>.
 */

import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";

import { countRows, verifyCutover } from "./checks";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

const arg = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const main = async () => {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;

  if (!url) throw new Error("DATABASE_URL is not set");

  const { hostname } = new URL(url);

  if (!LOCAL_HOSTS.includes(hostname) && arg("--confirm-host") !== hostname) {
    throw new Error(
      `DATABASE_URL points to ${hostname}. Pass --confirm-host ${hostname} if that is intended.`,
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    if (command === "snapshot") {
      const out = arg("--out") ?? "cutover-counts.json";
      const counts = await countRows(client);
      writeFileSync(out, JSON.stringify(counts, null, 2));
      console.log(`Counts saved to ${out}:`, counts);
      return;
    }

    if (command === "verify") {
      const before = JSON.parse(
        readFileSync(arg("--counts") ?? "cutover-counts.json", "utf8"),
      );
      const { problems, after } = await verifyCutover(client, before);
      console.log("Counts after:", after);

      if (problems.length > 0) {
        console.error(`Cutover check FAILED:\n  ${problems.join("\n  ")}`);
        process.exit(1);
      }

      console.log(
        "Cutover check passed: same counts, every row in a company, every user kept their role, RLS on.",
      );
      return;
    }

    throw new Error("Usage: db:cutover -- snapshot|verify ...");
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
