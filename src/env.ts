import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const buildPlaceholderDatabaseUrl =
  "postgresql://build:build@127.0.0.1:5432/build";
const buildPlaceholderAuthSecret = "build-time-placeholder-secret-min-32-chars";

const isVercelBuildWithoutEnv =
  process.env.VERCEL === "1" &&
  (!process.env.DATABASE_URL || !process.env.AUTH_SECRET);

const databaseUrl =
  process.env.DATABASE_URL ??
  (isVercelBuildWithoutEnv ? buildPlaceholderDatabaseUrl : undefined);

const authSecret =
  process.env.AUTH_SECRET ??
  (isVercelBuildWithoutEnv ? buildPlaceholderAuthSecret : undefined);

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: authSecret,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "1" || isVercelBuildWithoutEnv,
});
