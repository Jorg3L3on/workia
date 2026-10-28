import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Noto Sans Regular (SIL Open Font License 1.1). The file and the license
 * text live next to this module. react-pdf drops glyphs the font lacks
 * without throwing, so coverage is checked before a PDF is built.
 */
export const contractFontPath = path.join(
  process.cwd(),
  "src/lib/contracts/fonts/NotoSans-Regular.ttf",
);

export class ContractPdfGlyphError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `El contrato tiene caracteres que la fuente no puede imprimir: ${missing.join(" ")}`,
    );
    this.name = "ContractPdfGlyphError";
    this.missing = missing;
  }
}

type Covers = (codePoint: number) => boolean;

let coversCodePoint: Covers | null = null;

const readCmap = (bytes: Buffer): Covers => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableCount = view.getUint16(4);
  let cmapOffset = -1;

  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );

    if (tag === "cmap") cmapOffset = view.getUint32(record + 8);
  }

  if (cmapOffset < 0) return () => false;

  const encodings = view.getUint16(cmapOffset + 2);
  let format4 = -1;
  let format12 = -1;

  for (let index = 0; index < encodings; index += 1) {
    const record = cmapOffset + 4 + index * 8;
    const offset = cmapOffset + view.getUint32(record + 4);
    const format = view.getUint16(offset);

    if (format === 12) format12 = offset;
    if (format === 4) format4 = offset;
  }

  if (format12 >= 0) {
    const groups: { start: number; end: number }[] = [];
    const count = view.getUint32(format12 + 12);

    for (let index = 0; index < count; index += 1) {
      const base = format12 + 16 + index * 12;
      const start = view.getUint32(base);
      const end = view.getUint32(base + 4);
      const glyph = view.getUint32(base + 8);
      const first = glyph === 0 ? start + 1 : start;

      if (first <= end) groups.push({ start: first, end });
    }

    return (codePoint) =>
      groups.some(
        (group) => codePoint >= group.start && codePoint <= group.end,
      );
  }

  if (format4 < 0) return () => false;

  const segmentCount = view.getUint16(format4 + 6) / 2;
  let cursor = format4 + 14;
  const endCode: number[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    endCode.push(view.getUint16(cursor + index * 2));
  }

  cursor += segmentCount * 2 + 2;
  const startCode: number[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    startCode.push(view.getUint16(cursor + index * 2));
  }

  cursor += segmentCount * 2;
  const idDelta: number[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    idDelta.push(view.getInt16(cursor + index * 2));
  }

  cursor += segmentCount * 2;
  const idRangeOffsetAt = cursor;
  const idRangeOffset: number[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    idRangeOffset.push(view.getUint16(cursor + index * 2));
  }

  return (codePoint) => {
    if (codePoint > 0xffff) return false;

    let index = 0;

    while (index < segmentCount && endCode[index] < codePoint) index += 1;

    if (index >= segmentCount || startCode[index] > codePoint) return false;

    if (idRangeOffset[index] === 0) {
      return ((codePoint + idDelta[index]) & 0xffff) !== 0;
    }

    const glyphOffset =
      idRangeOffsetAt +
      index * 2 +
      idRangeOffset[index] +
      (codePoint - startCode[index]) * 2;
    const glyph = view.getUint16(glyphOffset);

    if (glyph === 0) return false;

    return ((glyph + idDelta[index]) & 0xffff) !== 0;
  };
};

const coverage = () => {
  coversCodePoint ??= readCmap(readFileSync(contractFontPath));
  return coversCodePoint;
};

/** Characters in `text` that Noto Sans cannot draw, in code-point order. */
export const missingGlyphs = (text: string) => {
  const covers = coverage();
  const missing: string[] = [];
  const seen = new Set<number>();

  for (const char of text) {
    const codePoint = char.codePointAt(0);

    // Tab is a missing glyph in Noto Sans. Newlines are structure, not ink.
    if (
      codePoint === undefined ||
      codePoint === 10 ||
      codePoint === 13 ||
      seen.has(codePoint)
    ) {
      continue;
    }

    seen.add(codePoint);

    if (!covers(codePoint)) missing.push(char);
  }

  missing.sort(
    (left, right) => (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0),
  );

  return missing;
};
