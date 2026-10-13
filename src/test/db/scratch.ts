import path from "node:path";
import { Client } from "pg";

import {
  applyPending,
  readMigrations,
  type Migration,
} from "@/lib/db/migrations/registry";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/**
 * The Postgres server database tests create their throwaway databases on:
 * TEST_DATABASE_URL, else DATABASE_URL. Only a server on this machine (or the
 * CI service container) is accepted, so a test never touches a shared database.
 */
export const testServerUrl = () => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "Database tests need TEST_DATABASE_URL (or DATABASE_URL) pointing to a local Postgres.",
    );
  }

  if (!LOCAL_HOSTS.includes(new URL(url).hostname)) {
    throw new Error(
      `Database tests only run against a local Postgres, not ${new URL(url).hostname}.`,
    );
  }

  return url;
};

export const databaseUrl = (serverUrl: string, database: string) => {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

const withClient = async <T>(
  url: string,
  fn: (client: Client) => Promise<T>,
) => {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

export const repositoryMigrations = () =>
  readMigrations(path.join(process.cwd(), "drizzle"));

/**
 * Creates an empty database named `workia_test_<suffix>` and applies
 * `migrations` (all of them by default). Returns its URL and a drop function.
 */
export const createScratchDatabase = async (
  suffix: string,
  migrations: Migration[] = repositoryMigrations(),
) => {
  const serverUrl = testServerUrl();
  const name = `workia_test_${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const url = databaseUrl(serverUrl, name);

  await withClient(serverUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(
      // WITH (FORCE) needs Postgres 13+; fall back for older servers.
      () => client.query(`DROP DATABASE IF EXISTS "${name}"`),
    );
    await client.query(`CREATE DATABASE "${name}"`);
  });

  await withClient(url, (client) => applyPending(client, migrations));

  return {
    url,
    name,
    query: <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
      withClient(
        url,
        async (client) => (await client.query(text, params)).rows as T[],
      ),
    migrate: (more: Migration[]) =>
      withClient(url, (client) => applyPending(client, more)),
    drop: () =>
      withClient(serverUrl, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      }),
  };
};
