import type { TestProject } from "vitest/node";

import { createScratchDatabase } from "./scratch";

/**
 * One migrated throwaway database for the whole `npm run test:db` run. Workers
 * read it from DATABASE_URL, so `@/lib/db` talks to it.
 */
export default async function setup(project: TestProject) {
  const database = await createScratchDatabase(`run_${process.pid}`);

  process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
  process.env.DATABASE_URL = database.url;
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
