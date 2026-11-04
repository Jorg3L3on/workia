import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/env";

import {
  assertObjectKey,
  clampExpiry,
  contentDisposition,
  type ObjectStorage,
} from "./shared";

/**
 * Development, test and e2e storage: files on disk, served by
 * GET /api/storage/local/[...key] with an HMAC token so a "signed URL" works
 * the same as in a bucket. Never used in production.
 */
export const LOCAL_STORAGE_ROUTE = "/api/storage/local";

// Development only: keep Turbopack from tracing the whole project for this path.
export const localStorageDir = () =>
  path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    env.STORAGE_LOCAL_DIR ?? ".storage",
  );

const filePath = (key: string) => {
  assertObjectKey(key);
  return path.join(localStorageDir(), ...key.split("/"));
};

const sign = (payload: string) =>
  createHmac("sha256", env.AUTH_SECRET)
    .update(`storage-local:${payload}`)
    .digest("base64url");

type LocalToken = {
  key: string;
  exp: number;
  ct: string;
  cd: string;
};

const tokenPayload = ({ key, exp, ct, cd }: LocalToken) =>
  JSON.stringify([key, exp, ct, cd]);

export const signLocalUrl = (token: LocalToken) => {
  const query = new URLSearchParams({
    exp: String(token.exp),
    ct: token.ct,
    cd: token.cd,
    sig: sign(tokenPayload(token)),
  });
  return `${LOCAL_STORAGE_ROUTE}/${token.key}?${query}`;
};

/** The token's headers when the signature matches and it has not expired. */
export const verifyLocalUrl = (
  key: string,
  query: URLSearchParams,
  now = Date.now(),
) => {
  const exp = Number(query.get("exp"));
  const ct = query.get("ct") ?? "";
  const cd = query.get("cd") ?? "";
  const sig = Buffer.from(query.get("sig") ?? "");
  const expected = Buffer.from(sign(tokenPayload({ key, exp, ct, cd })));
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(sig, expected) ||
    !Number.isFinite(exp) ||
    exp * 1000 < now
  ) {
    return null;
  }
  return { contentType: ct, contentDisposition: cd };
};

export const readLocalObject = async (key: string) => {
  try {
    return await readFile(filePath(key));
  } catch {
    return null;
  }
};

export const localStorageDriver = (): ObjectStorage => ({
  driver: "local",
  async put(key, body) {
    const target = filePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  },
  async delete(key) {
    await rm(filePath(key), { force: true });
  },
  async signedUrl(key, options) {
    assertObjectKey(key);
    return signLocalUrl({
      key,
      exp:
        Math.floor(Date.now() / 1000) + clampExpiry(options.expiresInSeconds),
      ct: options.contentType,
      cd: contentDisposition(options.filename, options.disposition),
    });
  },
});
