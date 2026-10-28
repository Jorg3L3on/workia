/**
 * Contract PDF (WRK-12). Prints `generatedText` as it was stored: paragraphs
 * and line breaks stay, and the signature lines (the underscore rule and the
 * names under it) stay together when the block fits on one page. The trial
 * length is whatever that text says; this file does not add or rewrite it.
 * A schedule annex starts on its own page only when «ANEXO A» is its own
 * line. A mention in the middle of a clause does not cut the text and does
 * not drop the schedule. Noto Sans (OFL, src/lib/contracts/fonts) is
 * embedded. Glyphs the font cannot draw fail the render instead of
 * disappearing. Tabs become spaces before that check, because the font has
 * no tab glyph.
 */

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import {
  ContractPdfGlyphError,
  contractFontPath,
  missingGlyphs,
} from "./glyphs";

export { ContractPdfGlyphError };

const FONT_SIZE = 11;
const LINE_HEIGHT = 1.4;
const PAGE_HEIGHT = 792;
const PAGE_PADDING_VERTICAL = 48 + 48;

export const CONTRACT_PDF_FONT_SIZE = FONT_SIZE;
export const CONTRACT_PDF_LINE_HEIGHT = LINE_HEIGHT;

const ANNEX_MARKER = "ANEXO A";
const ANNEX_HEADING = "ANEXO A. HORARIO";
const SIGNATURE_LINE = /_{8,}/;
const NBSP = "\u00A0";
const TAB_SPACES = "    ";

/** Lines of signature that still fit on an empty letter page. */
const maxSignatureLines = Math.floor(
  (PAGE_HEIGHT - PAGE_PADDING_VERTICAL) / (FONT_SIZE * LINE_HEIGHT),
);

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 56,
    fontFamily: "Noto Sans",
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: "#111827",
  },
  line: {
    fontFamily: "Noto Sans",
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  },
  signatureRow: {
    flexDirection: "row",
  },
  signatureCell: {
    flexGrow: 1,
    flexBasis: 0,
  },
});

const keepWord = (word: string) => [word];

let fontRegistered = false;

const ensureFont = () => {
  if (fontRegistered) return;

  Font.register({ family: "Noto Sans", src: contractFontPath });
  fontRegistered = true;
};

const normalizePdfText = (text: string) => text.replaceAll("\t", TAB_SPACES);

/** «ANEXO A» only when the line itself starts with that marker. */
const ANNEX_LINE = new RegExp(`^${ANNEX_MARKER}\\b`);
const annexLine = (line: string) => ANNEX_LINE.test(line.trim());

const annexLineOffset = (text: string) => {
  let offset = 0;
  const lines = text.split("\n");

  for (const line of lines) {
    if (annexLine(line)) return offset;

    offset += line.length + 1;
  }

  return -1;
};

type LineGroup = { signature: boolean; lines: string[] };

/**
 * Groups stored lines. Every branch consumes at least the current line, so a
 * signature line that also contains the annex marker cannot spin forever.
 */
export const groupLines = (lines: string[]): LineGroup[] => {
  const groups: LineGroup[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (SIGNATURE_LINE.test(line)) {
      const block = [line];
      index += 1;

      while (
        index < lines.length &&
        (lines[index] ?? "").trim() !== "" &&
        !annexLine(lines[index] ?? "")
      ) {
        block.push(lines[index] ?? "");
        index += 1;
      }

      groups.push({ signature: true, lines: block });
      continue;
    }

    const block = [line];
    index += 1;

    while (index < lines.length && !SIGNATURE_LINE.test(lines[index] ?? "")) {
      block.push(lines[index] ?? "");
      index += 1;
    }

    groups.push({ signature: false, lines: block });
  }

  return groups;
};

const signatureCells = (line: string) => {
  const cells = line.split(/\s{2,}/).filter((cell) => cell.length > 0);

  return cells.length > 0 ? cells : [NBSP];
};

const SignatureBlock = ({ lines }: { lines: string[] }) => (
  <View wrap={lines.length <= maxSignatureLines ? false : true}>
    {lines.map((line, rowIndex) => {
      const cells = signatureCells(line);

      return (
        <View key={rowIndex} style={styles.signatureRow}>
          {cells.map((cell, cellIndex) => (
            <View key={cellIndex} style={styles.signatureCell}>
              <Text hyphenationCallback={keepWord} style={styles.line}>
                {cell}
              </Text>
            </View>
          ))}
        </View>
      );
    })}
  </View>
);

const ContractLines = ({ text }: { text: string }) => (
  <>
    {groupLines(text.split("\n")).map((group, index) => {
      if (group.signature) {
        return <SignatureBlock key={index} lines={group.lines} />;
      }

      return (
        <View key={index}>
          {group.lines.map((line, lineIndex) => (
            <Text
              hyphenationCallback={keepWord}
              key={`${index}-${lineIndex}`}
              style={styles.line}
            >
              {line.length === 0 ? NBSP : line}
            </Text>
          ))}
        </View>
      );
    })}
  </>
);

export type ContractPdfInput = {
  generatedText: string;
  scheduleText: string;
};

const prepareContractPdf = ({
  generatedText,
  scheduleText,
}: ContractPdfInput) => {
  const text = normalizePdfText(generatedText);
  const schedule = normalizePdfText(scheduleText);
  const at = annexLineOffset(text);

  if (at === -1) {
    const base = text.endsWith("\n") ? text : `${text}\n`;

    return {
      body: text,
      annexText: `\n${ANNEX_HEADING}\n\n${schedule}`,
      plain: `${base}\n${ANNEX_HEADING}\n\n${schedule}`,
    };
  }

  return {
    body: text.slice(0, at),
    annexText: text.slice(at),
    plain: text,
  };
};

/** The plain text a successful PDF must yield, including the schedule annex. */
export const contractPdfPlainText = (input: ContractPdfInput) =>
  prepareContractPdf(input).plain;

export const ContractPdf = (input: ContractPdfInput) => {
  const { body, annexText } = prepareContractPdf(input);

  return (
    <Document author="Workia" creator="Workia" title="Contrato">
      <Page size="LETTER" style={styles.page}>
        <ContractLines text={body} />
      </Page>
      <Page size="LETTER" style={styles.page}>
        <ContractLines text={annexText} />
      </Page>
    </Document>
  );
};

/** PDF bytes, or ContractPdfGlyphError when the font cannot draw the text. */
export const renderContractPdf = async (input: ContractPdfInput) => {
  const missing = missingGlyphs(contractPdfPlainText(input));

  if (missing.length > 0) throw new ContractPdfGlyphError(missing);

  ensureFont();

  return renderToBuffer(<ContractPdf {...input} />);
};
