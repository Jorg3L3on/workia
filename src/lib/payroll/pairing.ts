/**
 * Pairs the files of a provider's zip (W2-03): each XML with the PDF of the
 * same name, ignoring folders and case. Runs in the browser, before upload,
 * so a 500-receipt zip goes up one small request per receipt instead of one
 * body larger than a function accepts.
 */

export type ZipEntry = { path: string; size: number };

export type ReceiptPair<T extends ZipEntry> = {
  /** File name without folder or extension, e.g. "A1F3…" or "000123_2026Q20". */
  name: string;
  xml: T;
  pdf: T | null;
};

export type PairingResult<T extends ZipEntry> = {
  pairs: ReceiptPair<T>[];
  /** PDFs with no XML of the same name: they cannot be matched, so they are listed. */
  orphanPdfs: T[];
  /** Files that are neither XML nor PDF (folders, thumbnails, __MACOSX). */
  ignored: T[];
};

const baseName = (path: string) => {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf(".");

  return {
    stem: (dot > 0 ? file.slice(0, dot) : file).trim(),
    ext: dot > 0 ? file.slice(dot + 1).toLowerCase() : "",
  };
};

const isJunk = (path: string) =>
  path.startsWith("__MACOSX/") ||
  path.includes("/__MACOSX/") ||
  (path.split(/[\\/]/).pop() ?? "").startsWith("._") ||
  path.endsWith("/");

export const pairReceiptFiles = <T extends ZipEntry>(
  entries: readonly T[],
): PairingResult<T> => {
  const xmls = new Map<string, T>();
  const pdfs = new Map<string, T>();
  const ignored: T[] = [];

  for (const entry of entries) {
    const { stem, ext } = baseName(entry.path);
    const key = stem.toLowerCase();

    if (isJunk(entry.path) || !stem) {
      ignored.push(entry);
    } else if (ext === "xml" && !xmls.has(key)) {
      xmls.set(key, entry);
    } else if (ext === "pdf" && !pdfs.has(key)) {
      pdfs.set(key, entry);
    } else {
      ignored.push(entry);
    }
  }

  const pairs = [...xmls.entries()]
    .map(([key, xml]) => ({
      name: baseName(xml.path).stem,
      xml,
      pdf: pdfs.get(key) ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const orphanPdfs = [...pdfs.entries()]
    .filter(([key]) => !xmls.has(key))
    .map(([, pdf]) => pdf);

  return { pairs, orphanPdfs, ignored };
};
