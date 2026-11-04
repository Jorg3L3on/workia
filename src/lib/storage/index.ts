import { env } from "@/env";

import { localStorageDriver } from "./local";
import type { ObjectStorage } from "./shared";
import { s3StorageDriver } from "./s3";

export * from "./keys";
export * from "./shared";

/**
 * Private object storage for files that never go in Neon: document files
 * (W2-04), nómina receipts (W2-03), and any later PDF. Which bucket to use is
 * Jorge's decision, so this is an interface with two drivers:
 *
 * - "s3": any S3-compatible bucket (Cloudflare R2, Backblaze B2, MinIO, ...),
 *   presigned with SigV4 and no SDK. The provider encrypts at rest.
 * - "local": files on disk under STORAGE_LOCAL_DIR, for development, tests and
 *   e2e. Refused in production (Vercel's disk does not persist).
 *
 * Unconfigured production returns null: the UI hides uploads and says why.
 * Every caller that hands out signedUrl() also writes recordPersonalDataAccess.
 */
export type StorageDriverName = "s3" | "local";

/** The configured driver name, or null when no storage is available. */
export const storageDriverName = (): StorageDriverName | null => {
  const configured = env.STORAGE_DRIVER;
  if (configured === "s3") return s3Configured() ? "s3" : null;
  if (configured === "local") {
    return env.NODE_ENV === "production" ? null : "local";
  }
  if (s3Configured()) return "s3";
  return env.NODE_ENV === "production" ? null : "local";
};

const s3Configured = () =>
  Boolean(
    env.S3_ENDPOINT &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY,
  );

/** The storage in use, or null when production has none configured. */
export const getObjectStorage = (): ObjectStorage | null => {
  const driver = storageDriverName();
  if (driver === "s3") return s3StorageDriver();
  if (driver === "local") return localStorageDriver();
  return null;
};
