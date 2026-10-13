import path from "node:path";
import { defineConfig } from "vitest/config";

// Database tests: real Postgres, one throwaway database per run.
// `npm run test:db` (needs a local Postgres in DATABASE_URL or TEST_DATABASE_URL).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["./src/test/db/global-setup.ts"],
    // Tests share one database; files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
