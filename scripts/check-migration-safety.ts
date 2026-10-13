/**
 * Fails when a pull request adds or changes a SQL migration that can lose or
 * rewrite data, unless the file carries `-- data-loss-ok: <reason>`.
 *
 *   npm run check:migrations [-- --base <ref>]
 *
 * Base defaults to origin/$GITHUB_BASE_REF in CI, otherwise origin/sandbox.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  evaluateMigrations,
  formatViolations,
} from "@/lib/db/migrations/safety";

const baseFlag = process.argv.indexOf("--base");
const base =
  baseFlag !== -1
    ? process.argv[baseFlag + 1]
    : process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : "origin/sandbox";

let changed: string[];

try {
  changed = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--diff-filter=AM",
      `${base}...HEAD`,
      "--",
      "drizzle",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /^drizzle\/[^/]+\.sql$/.test(file));
} catch {
  console.error(
    `Could not diff against ${base}. Fetch it first (git fetch origin) or pass --base <ref>.`,
  );
  process.exit(2);
}

if (changed.length === 0) {
  console.log(
    `Migration safety: no migrations added or changed against ${base}.`,
  );
  process.exit(0);
}

const { violations, approved } = evaluateMigrations(
  changed.map((file) => ({ path: file, sql: readFileSync(file, "utf8") })),
);

for (const file of approved) {
  console.log(
    `Migration safety: ${file} has risky statements but carries a data-loss-ok approval.`,
  );
}

if (violations.length > 0) {
  console.error(formatViolations(violations));
  process.exit(1);
}

console.log(
  `Migration safety: ${changed.length} migration(s) checked, nothing destructive.`,
);
