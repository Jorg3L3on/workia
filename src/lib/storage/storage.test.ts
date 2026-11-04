import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  AUTH_SECRET: "ci-auth-secret-with-at-least-32-characters",
  NODE_ENV: "test",
  STORAGE_LOCAL_DIR: undefined as string | undefined,
}));

vi.mock("@/env", () => ({ env }));

import {
  contentDisposition,
  isValidObjectKey,
  objectKey,
  objectKeyCompany,
} from "./index";
import { localStorageDriver, readLocalObject, verifyLocalUrl } from "./local";

const company = "8d2b8f0e-6a4e-4c21-9b77-0d4a1c9c1a10";
const person = "3c1f4f6e-1111-4c21-9b77-0d4a1c9c1a10";
const file = "55555555-1111-4c21-9b77-0d4a1c9c1a10";

describe("objectKey", () => {
  it("joins ids into a key the route can check", () => {
    const key = objectKey({
      companyId: company,
      area: "documents",
      segments: [person, file],
      ext: "pdf",
    });

    expect(key).toBe(`${company}/documents/${person}/${file}.pdf`);
    expect(isValidObjectKey(key)).toBe(true);
    expect(objectKeyCompany(key)).toBe(company);
  });

  it("rejects segments that could escape the folder", () => {
    for (const bad of ["..", "a/b", "", "a b", "ñ"]) {
      expect(() =>
        objectKey({
          companyId: company,
          area: "receipts",
          segments: [bad],
          ext: "xml",
        }),
      ).toThrow();
    }
    expect(isValidObjectKey(`${company}/documents/../x.pdf`)).toBe(false);
    expect(isValidObjectKey(`/${company}/documents/x.pdf`)).toBe(false);
    expect(isValidObjectKey(`${company}/other/x.pdf`)).toBe(false);
    expect(isValidObjectKey(`${company}/documents/x.exe`)).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("keeps an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("Acta de nacimiento – Peña.pdf")).toBe(
      `inline; filename="Acta de nacimiento _ Pena.pdf"; filename*=UTF-8''Acta%20de%20nacimiento%20%E2%80%93%20Pe%C3%B1a.pdf`,
    );
  });
});

describe("local driver", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "workia-storage-"));
    env.STORAGE_LOCAL_DIR = dir;
  });

  afterAll(async () => {
    env.STORAGE_LOCAL_DIR = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  const key = `${company}/documents/${person}/${file}.pdf`;

  it("stores, signs, verifies and deletes", async () => {
    const storage = localStorageDriver();
    await storage.put(
      key,
      new TextEncoder().encode("%PDF-1.7"),
      "application/pdf",
    );

    const url = new URL(
      await storage.signedUrl(key, {
        filename: "INE.pdf",
        contentType: "application/pdf",
      }),
      "http://localhost",
    );
    expect(url.pathname).toBe(`/api/storage/local/${key}`);
    expect(verifyLocalUrl(key, url.searchParams)).toEqual({
      contentType: "application/pdf",
      contentDisposition: contentDisposition("INE.pdf"),
    });
    expect(
      new TextDecoder().decode((await readLocalObject(key)) ?? undefined),
    ).toBe("%PDF-1.7");

    await storage.delete(key);
    expect(await readLocalObject(key)).toBeNull();
  });

  it("rejects a tampered or expired URL", async () => {
    const storage = localStorageDriver();
    const url = new URL(
      await storage.signedUrl(key, {
        filename: "INE.pdf",
        contentType: "application/pdf",
        expiresInSeconds: 60,
      }),
      "http://localhost",
    );
    const other = `${company}/documents/${person}/${person}.pdf`;
    expect(verifyLocalUrl(other, url.searchParams)).toBeNull();

    const tampered = new URLSearchParams(url.searchParams);
    tampered.set("ct", "text/html");
    expect(verifyLocalUrl(key, tampered)).toBeNull();

    expect(
      verifyLocalUrl(key, url.searchParams, Date.now() + 61_000),
    ).toBeNull();
  });
});
