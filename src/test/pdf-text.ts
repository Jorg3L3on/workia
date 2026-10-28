import { inflateSync } from "node:zlib";

import {
  CONTRACT_PDF_FONT_SIZE,
  CONTRACT_PDF_LINE_HEIGHT,
} from "@/lib/contracts/pdf";

const NBSP = "\u00A0";
const LINE_HEIGHT = CONTRACT_PDF_FONT_SIZE * CONTRACT_PDF_LINE_HEIGHT;

const CP1252: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

const decodeWinAnsi = (bytes: Buffer) => {
  let text = "";

  for (const byte of bytes) {
    text += CP1252[byte] ?? String.fromCharCode(byte);
  }

  return text;
};

const decodeUtf16be = (hex: string) => {
  const units: number[] = [];

  for (let index = 0; index < hex.length; index += 4) {
    units.push(Number.parseInt(hex.slice(index, index + 4), 16));
  }

  return String.fromCharCode(...units);
};

const toUnicodeMap = (stream: string) => {
  const map = new Map<number, string>();
  const tokens =
    stream
      .replace(/%[^\n]*/g, "")
      .match(
        /<[0-9A-Fa-f]+>|\[[^\]]*\]|\d+|beginbfchar|endbfchar|beginbfrange|endbfrange/g,
      ) ?? [];
  let index = 0;

  while (index < tokens.length) {
    const countToken = tokens[index] ?? "";
    const kind = tokens[index + 1];

    if (
      !/^\d+$/.test(countToken) ||
      (kind !== "beginbfchar" && kind !== "beginbfrange")
    ) {
      index += 1;
      continue;
    }

    const count = Number(countToken);
    index += 2;

    for (let entry = 0; entry < count; entry += 1) {
      if (kind === "beginbfchar") {
        map.set(
          Number.parseInt((tokens[index] ?? "").slice(1, -1), 16),
          decodeUtf16be((tokens[index + 1] ?? "").slice(1, -1)),
        );
        index += 2;
        continue;
      }

      const start = Number.parseInt((tokens[index] ?? "").slice(1, -1), 16);
      const end = Number.parseInt((tokens[index + 1] ?? "").slice(1, -1), 16);
      const third = tokens[index + 2] ?? "";

      if (third.startsWith("[")) {
        const destinations = [...third.matchAll(/<([0-9A-Fa-f]+)>/g)].map(
          (match) => decodeUtf16be(match[1] ?? ""),
        );

        destinations.forEach((destination, offset) => {
          map.set(start + offset, destination);
        });
      } else {
        const first = decodeUtf16be(third.slice(1, -1)).codePointAt(0) ?? 0;

        for (let code = start; code <= end; code += 1) {
          map.set(code, String.fromCodePoint(first + (code - start)));
        }
      }

      index += 3;
    }
  }

  return map;
};

const decodeShow = (hex: string, map: Map<number, string>) => {
  if (hex.length >= 4 && hex.length % 4 === 0) {
    const first = Number.parseInt(hex.slice(0, 4), 16);

    if (map.has(first)) {
      let text = "";

      for (let index = 0; index < hex.length; index += 4) {
        const id = Number.parseInt(hex.slice(index, index + 4), 16);
        text += map.get(id) ?? "\uFFFD";
      }

      return text;
    }
  }

  return decodeWinAnsi(Buffer.from(hex, "hex"));
};

const multiply = (left: number[], right: number[]) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];

const apply = (matrix: number[], x: number, y: number) => [
  matrix[0] * x + matrix[2] * y + matrix[4],
  matrix[1] * x + matrix[3] * y + matrix[5],
];

const pageText = (stream: string, map: Map<number, string>) => {
  const tokens =
    stream.match(
      /q|Q|BT|ET|[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+cm|[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+Tm|\[[^\]]*\]\s*TJ|\((?:\\.|[^\\)])*\)\s*Tj/g,
    ) ?? [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let textMatrix = [1, 0, 0, 1, 0, 0];
  const items: { x: number; y: number; text: string }[] = [];

  for (const token of tokens) {
    if (token === "q") {
      stack.push([...ctm]);
      continue;
    }

    if (token === "Q") {
      ctm = stack.pop() ?? ctm;
      continue;
    }

    if (token === "BT") {
      textMatrix = [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (token.endsWith("cm")) {
      const values = token.trim().split(/\s+/).slice(0, 6).map(Number);
      ctm = multiply(values, ctm);
      continue;
    }

    if (token.endsWith("Tm")) {
      textMatrix = token.trim().split(/\s+/).slice(0, 6).map(Number);
      continue;
    }

    if (!token.endsWith("TJ") && !token.endsWith("Tj")) continue;

    const [x, y] = apply(multiply(ctm, textMatrix), 0, 0);
    let text = "";

    if (token.endsWith("TJ")) {
      for (const part of token.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        text += decodeShow(part[1] ?? "", map);
      }
    }

    items.push({ x, y, text });
  }

  items.sort((left, right) => right.y - left.y || left.x - right.x);

  const lines: { y: number; text: string }[] = [];

  for (const item of items) {
    const last = lines.at(-1);

    if (last && Math.abs(last.y - item.y) < 0.8) {
      last.text += item.text;
    } else {
      lines.push({ y: item.y, text: item.text });
    }
  }

  let page = "";

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]?.text ?? "";
    const text = raw === NBSP ? "" : raw;

    if (index === 0) {
      page = text;
      continue;
    }

    const gap = Math.round(
      ((lines[index - 1]?.y ?? 0) - (lines[index]?.y ?? 0)) / LINE_HEIGHT,
    );
    const wrapped = (lines[index - 1]?.text ?? "").endsWith(" ") && gap === 1;

    page += wrapped ? text : `${"\n".repeat(Math.max(gap, 1))}${text}`;
  }

  return page;
};

const streamsOf = (buffer: Buffer) => {
  const raw = buffer.toString("latin1");
  const streams: string[] = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match = pattern.exec(raw);

  while (match) {
    const body = Buffer.from(match[1] ?? "", "latin1");

    try {
      streams.push(inflateSync(body).toString("latin1"));
    } catch {
      streams.push(body.toString("latin1"));
    }

    match = pattern.exec(raw);
  }

  return streams;
};

/** Text of each page, in order, reconstructed from the PDF content streams. */
export const extractPdfPages = (buffer: Buffer) => {
  const streams = streamsOf(buffer);
  const map = new Map<number, string>();

  for (const stream of streams) {
    if (!stream.includes("beginbfchar") && !stream.includes("beginbfrange")) {
      continue;
    }

    for (const [code, value] of toUnicodeMap(stream)) map.set(code, value);
  }

  return streams
    .filter((stream) => stream.includes("BT") && stream.includes("TJ"))
    .map((stream) => pageText(stream, map));
};

/** The contract text a reader copies out of the PDF. */
export const extractPdfText = (buffer: Buffer) => {
  let text = "";

  for (const page of extractPdfPages(buffer)) {
    if (!text) {
      text = page;
      continue;
    }

    text += text.endsWith(" ") || text.endsWith("\n") ? page : `\n${page}`;
  }

  return text;
};
