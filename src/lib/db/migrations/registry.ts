import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Registry of applied migrations, keyed by tag (the file name without .sql).
 *
 * Drizzle's own migrator only compares against the newest applied timestamp,
 * so a migration merged from a parallel branch with an older `when` would be
 * skipped silently. Keying by tag applies every migration exactly once,
 * whatever order branches merge in. See docs/migrations.md.
 */

export const REGISTRY_SCHEMA = "drizzle";
export const REGISTRY_TABLE = "applied_migrations";
const REGISTRY = `"${REGISTRY_SCHEMA}"."${REGISTRY_TABLE}"`;
// Any constant works; it keeps two `db:migrate` runs from interleaving.
const ADVISORY_LOCK_ID = 7_412_004_002;

export type Migration = {
  tag: string;
  hash: string;
  statements: string[];
};

export type AppliedMigration = {
  tag: string;
  hash: string;
  mode: "applied" | "baseline";
  appliedAt: Date;
};

/** Minimal client shape, satisfied by `pg.Client`. */
export type SqlClient = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

export const hashMigration = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");

/** Same split Drizzle uses, minus empty chunks. */
export const splitStatements = (sql: string) =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

/**
 * Reads migrations in journal order and checks that the journal and the .sql
 * files agree: a file outside the journal would never run.
 */
export const readMigrations = (folder: string): Migration[] => {
  const journalPath = path.join(folder, "meta", "_journal.json");

  if (!existsSync(journalPath)) {
    throw new Error(`Missing ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const tags = journal.entries.map((entry) => entry.tag);
  const files = readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""));

  const duplicated = tags.filter((tag, index) => tags.indexOf(tag) !== index);
  const missingFile = tags.filter((tag) => !files.includes(tag));
  const notInJournal = files.filter((file) => !tags.includes(file));
  const problems = [
    ...duplicated.map((tag) => `journal lists ${tag} twice`),
    ...missingFile.map(
      (tag) => `journal lists ${tag} but ${tag}.sql is missing`,
    ),
    ...notInJournal.map(
      (file) =>
        `${file}.sql is not in meta/_journal.json, so it would never run`,
    ),
  ];

  if (problems.length > 0) {
    throw new Error(
      `Migrations folder is inconsistent:\n  ${problems.join("\n  ")}`,
    );
  }

  return tags.map((tag) => {
    const sql = readFileSync(path.join(folder, `${tag}.sql`), "utf8");

    return { tag, hash: hashMigration(sql), statements: splitStatements(sql) };
  });
};

export type MigrationPlan = {
  pending: Migration[];
  /** Applied, but the file changed afterwards. Never edit an applied migration. */
  changed: { tag: string; appliedHash: string; fileHash: string }[];
  /** In the registry but no longer in the folder. */
  unknown: string[];
};

export const planMigrations = (
  migrations: Migration[],
  applied: Pick<AppliedMigration, "tag" | "hash">[],
): MigrationPlan => {
  const appliedByTag = new Map(applied.map((row) => [row.tag, row.hash]));
  const tags = new Set(migrations.map((migration) => migration.tag));

  return {
    pending: migrations.filter((migration) => !appliedByTag.has(migration.tag)),
    changed: migrations.flatMap((migration) => {
      const appliedHash = appliedByTag.get(migration.tag);

      return appliedHash && appliedHash !== migration.hash
        ? [{ tag: migration.tag, appliedHash, fileHash: migration.hash }]
        : [];
    }),
    unknown: applied.map((row) => row.tag).filter((tag) => !tags.has(tag)),
  };
};

/** Journal entries up to and including the one whose tag starts with `through`. */
export const migrationsThrough = (migrations: Migration[], through: string) => {
  const index = migrations.findIndex(
    (migration) =>
      migration.tag === through || migration.tag.startsWith(`${through}_`),
  );

  if (index === -1) {
    throw new Error(`No migration matches "${through}"`);
  }

  return migrations.slice(0, index + 1);
};

export const ensureRegistry = async (client: SqlClient) => {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${REGISTRY_SCHEMA}"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY} (
      "tag" text PRIMARY KEY,
      "hash" text NOT NULL,
      "mode" text NOT NULL CHECK ("mode" IN ('applied', 'baseline')),
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
};

export const readApplied = async (
  client: SqlClient,
): Promise<AppliedMigration[]> => {
  const { rows } = await client.query(
    `SELECT "tag", "hash", "mode", "applied_at" FROM ${REGISTRY} ORDER BY "applied_at", "tag"`,
  );

  return rows.map((row) => ({
    tag: String(row.tag),
    hash: String(row.hash),
    mode: row.mode as AppliedMigration["mode"],
    appliedAt: new Date(row.applied_at as string),
  }));
};

const withLock = async <T>(client: SqlClient, fn: () => Promise<T>) => {
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);

  try {
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
  }
};

const assertConsistent = (plan: MigrationPlan) => {
  if (plan.changed.length > 0) {
    throw new Error(
      `These applied migrations were edited afterwards; write a new migration instead:\n  ${plan.changed
        .map((row) => row.tag)
        .join("\n  ")}`,
    );
  }
};

/**
 * Applies pending migrations in journal order, each in its own transaction
 * together with its registry row. Running it again applies nothing.
 */
export const applyPending = async (
  client: SqlClient,
  migrations: Migration[],
  log: (message: string) => void = () => {},
) => {
  await ensureRegistry(client);

  return withLock(client, async () => {
    const plan = planMigrations(migrations, await readApplied(client));
    assertConsistent(plan);

    for (const migration of plan.pending) {
      await client.query("BEGIN");

      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }

        await client.query(
          `INSERT INTO ${REGISTRY} ("tag", "hash", "mode") VALUES ($1, $2, 'applied')`,
          [migration.tag, migration.hash],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${migration.tag} failed and was rolled back: ${(error as Error).message}`,
        );
      }

      log(`applied ${migration.tag}`);
    }

    return plan.pending.map((migration) => migration.tag);
  });
};

/**
 * Records migrations as applied without running them, for a database whose
 * schema already has them (production before the registry existed).
 */
export const baseline = async (
  client: SqlClient,
  migrations: Migration[],
  log: (message: string) => void = () => {},
) => {
  await ensureRegistry(client);

  return withLock(client, async () => {
    const plan = planMigrations(migrations, await readApplied(client));
    assertConsistent(plan);

    await client.query("BEGIN");

    try {
      for (const migration of plan.pending) {
        await client.query(
          `INSERT INTO ${REGISTRY} ("tag", "hash", "mode") VALUES ($1, $2, 'baseline')`,
          [migration.tag, migration.hash],
        );
        log(`baselined ${migration.tag}`);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    return plan.pending.map((migration) => migration.tag);
  });
};
