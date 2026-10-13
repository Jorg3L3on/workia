import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { createScratchDatabase, databaseUrl, testServerUrl } from "./scratch";

/** Login role the app uses under TEST_RLS=1: member of workia_app, no BYPASSRLS. */
const RLS_TEST_ROLE = "workia_app_test";
const RLS_TEST_PASSWORD = "workia-app-test";

const ensureRlsRole = async () => {
  const client = new Client({ connectionString: testServerUrl() });
  await client.connect();

  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [RLS_TEST_ROLE],
    );

    if (rows.length === 0) {
      await client.query(
        `CREATE ROLE ${RLS_TEST_ROLE} LOGIN NOBYPASSRLS PASSWORD '${RLS_TEST_PASSWORD}'`,
      );
    }

    await client.query(`GRANT workia_app TO ${RLS_TEST_ROLE}`);
  } finally {
    await client.end();
  }
};

/**
 * One migrated throwaway database for the whole `npm run test:db` run. Workers
 * read it from DATABASE_URL, so `@/lib/db` talks to it.
 */
export default async function setup(project: TestProject) {
  const database = await createScratchDatabase(`run_${process.pid}`);

  process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
  // Fixtures and assertions write and read as the owner, never through RLS.
  process.env.TEST_OWNER_DATABASE_URL = database.url;
  process.env.DATABASE_URL = database.url;

  if (process.env.TEST_RLS === "1") {
    // The app connects as a role row-level security applies to (migration 0018).
    await ensureRlsRole();
    const url = new URL(databaseUrl(testServerUrl(), database.name));
    url.username = RLS_TEST_ROLE;
    url.password = RLS_TEST_PASSWORD;
    process.env.DATABASE_URL = url.toString();
    process.env.DATABASE_RLS = "1";
  }
  process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters";
  project.provide("databaseUrl", database.url);

  return async () => {
    await database.drop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
