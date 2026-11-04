import { env } from "@/env";

import {
  assertObjectKey,
  clampExpiry,
  contentDisposition,
  type ObjectStorage,
} from "./shared";
import { presignUrl } from "./sigv4";

/** Any S3-compatible bucket, path-style (works on R2, B2 and MinIO). */
export const s3StorageDriver = (): ObjectStorage => {
  const endpoint = new URL(env.S3_ENDPOINT!);
  const bucket = env.S3_BUCKET!;
  const base = {
    host: endpoint.host,
    protocol: endpoint.protocol as "https:" | "http:",
    region: env.S3_REGION ?? "auto",
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  };
  const path = (key: string) => `/${bucket}/${key}`;

  return {
    driver: "s3",
    async put(key, body, contentType) {
      assertObjectKey(key);
      const url = presignUrl({
        ...base,
        method: "PUT",
        path: path(key),
        expiresInSeconds: 300,
      });
      const response = await fetch(url, {
        method: "PUT",
        body: body as BodyInit,
        headers: { "content-type": contentType },
      });
      if (!response.ok) {
        throw new Error(`Object storage PUT failed (${response.status})`);
      }
    },
    async delete(key) {
      assertObjectKey(key);
      const url = presignUrl({
        ...base,
        method: "DELETE",
        path: path(key),
        expiresInSeconds: 300,
      });
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Object storage DELETE failed (${response.status})`);
      }
    },
    async signedUrl(key, options) {
      assertObjectKey(key);
      return presignUrl({
        ...base,
        method: "GET",
        path: path(key),
        expiresInSeconds: clampExpiry(options.expiresInSeconds),
        query: {
          "response-content-disposition": contentDisposition(
            options.filename,
            options.disposition,
          ),
          "response-content-type": options.contentType,
        },
      });
    },
  };
};
