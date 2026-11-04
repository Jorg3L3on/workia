import { isValidObjectKey } from "./keys";

export type SignedUrlOptions = {
  /** Download name shown to the person (Content-Disposition). */
  filename: string;
  contentType: string;
  /** Default 300 (five minutes), at most 3600. */
  expiresInSeconds?: number;
  /** "inline" opens in the browser (default), "attachment" downloads. */
  disposition?: "inline" | "attachment";
};

export interface ObjectStorage {
  readonly driver: "s3" | "local";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** A short-lived URL that serves the object; absolute for s3, app-relative for local. */
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
}

export class StorageKeyError extends Error {
  constructor() {
    super("Invalid object key");
    this.name = "StorageKeyError";
  }
}

export const assertObjectKey = (key: string) => {
  if (!isValidObjectKey(key)) throw new StorageKeyError();
};

export const clampExpiry = (seconds: number | undefined) =>
  Math.min(Math.max(Math.trunc(seconds ?? 300), 1), 3600);

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
export const contentDisposition = (
  filename: string,
  disposition: "inline" | "attachment" = "inline",
) => {
  const ascii =
    filename
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]|["\\]/g, "_")
      .trim() || "archivo";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};
