/**
 * Object keys: <companyId>/<area>/<segment>/.../<segment>.<ext>. Segments are
 * ids (uuid, CFDI UUID, ...) so a key never carries a person's name or a
 * user-typed file name, and a key from the URL can be checked before use.
 */
export const STORAGE_AREAS = ["documents", "receipts", "contracts"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

export const STORAGE_EXTENSIONS = [
  "pdf",
  "jpg",
  "png",
  "webp",
  "heic",
  "xml",
] as const;
export type StorageExtension = (typeof STORAGE_EXTENSIONS)[number];

const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

export const objectKey = (input: {
  companyId: string;
  area: StorageArea;
  /** One or more ids, e.g. [personId, documentId] or [periodId, cfdiUuid]. */
  segments: readonly string[];
  ext: StorageExtension;
}) => {
  const parts = [input.companyId, input.area, ...input.segments];
  if (input.segments.length === 0 || parts.some((p) => !SEGMENT.test(p))) {
    throw new Error("Invalid object key segment");
  }
  return `${parts.join("/")}.${input.ext}`;
};

const KEY = new RegExp(
  `^[A-Za-z0-9-]{1,64}/(${STORAGE_AREAS.join("|")})(/[A-Za-z0-9-]{1,64})+\\.(${STORAGE_EXTENSIONS.join("|")})$`,
);

/** True for keys objectKey can produce; rejects "..", absolute paths, etc. */
export const isValidObjectKey = (key: string) => KEY.test(key);

/** The company a key belongs to (its first segment). */
export const objectKeyCompany = (key: string) => key.split("/", 1)[0]!;
