/**
 * Contract PDF (WRK-12). Prints `generatedText` as it was stored: paragraphs
 * and line breaks stay, and the signature lines (the underscore rule and the
 * names under it) move together so they are not split across pages. The trial
 * length is whatever that text says; this file does not add or rewrite it.
 * A schedule annex starts on its own page. If the stored text already contains
 * «ANEXO A», that part starts the new page and is not repeated.
 * Noto Sans (OFL, src/lib/contracts/fonts) is embedded. Glyphs the font cannot
 * draw fail the render instead of disappearing.
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

export const CONTRACT_PDF_FONT_SIZE = FONT_SIZE;
export const CONTRACT_PDF_LINE_HEIGHT = LINE_HEIGHT;

const ANNEX_MARKER = "ANEXO A";
const ANNEX_HEADING = "ANEXO A. HORARIO";
const SIGNATURE_LINE = /_{8,}/;
const NBSP = "\u00A0";

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
});

const keepWord = (word: string) => [word];

let fontRegistered = false;

const ensureFont = () => {
  if (fontRegistered) return;

  Font.register({ family: "Noto Sans", src: contractFontPath });
  fontRegistered = true;
};

type LineGroup = { signature: boolean; lines: string[] };

const groupLines = (lines: string[]): LineGroup[] => {
  const groups: LineGroup[] = [];
  let index = 0;

  while (index < lines.length) {
    if (SIGNATURE_LINE.test(lines[index] ?? "")) {
      const block: string[] = [];

      while (
        index < lines.length &&
        lines[index].trim() !== "" &&
        !lines[index].includes(ANNEX_MARKER)
      ) {
        block.push(lines[index]);
        index += 1;
      }

      groups.push({ signature: true, lines: block });
      continue;
    }

    const block: string[] = [];

    while (index < lines.length && !SIGNATURE_LINE.test(lines[index] ?? "")) {
      block.push(lines[index]);
      index += 1;
    }

    if (block.length > 0) groups.push({ signature: false, lines: block });
  }

  return groups;
};

const ContractLines = ({ text }: { text: string }) => (
  <>
    {groupLines(text.split("\n")).map((group, index) => {
      const lines = group.lines.map((line, lineIndex) => (
        <Text
          hyphenationCallback={keepWord}
          key={`${index}-${lineIndex}`}
          style={styles.line}
        >
          {line.length === 0 ? NBSP : line}
        </Text>
      ));

      if (group.signature) {
        return (
          <View key={index} wrap={false}>
            {lines}
          </View>
        );
      }

      return <View key={index}>{lines}</View>;
    })}
  </>
);

export type ContractPdfInput = {
  generatedText: string;
  scheduleText: string;
};

/** The plain text a successful PDF must yield, including the schedule annex. */
export const contractPdfPlainText = ({
  generatedText,
  scheduleText,
}: ContractPdfInput) => {
  if (generatedText.includes(ANNEX_MARKER)) return generatedText;

  const base = generatedText.endsWith("\n")
    ? generatedText
    : `${generatedText}\n`;

  return `${base}\n${ANNEX_HEADING}\n\n${scheduleText}`;
};

const splitStoredText = (generatedText: string) => {
  const at = generatedText.indexOf(ANNEX_MARKER);

  if (at === -1) {
    return {
      body: generatedText,
      annex: `\n${ANNEX_HEADING}\n\n`,
    };
  }

  return {
    body: generatedText.slice(0, at),
    annex: generatedText.slice(at),
  };
};

export const ContractPdf = ({
  generatedText,
  scheduleText,
}: ContractPdfInput) => {
  const embedded = generatedText.includes(ANNEX_MARKER);
  const { body, annex } = splitStoredText(generatedText);
  const annexText = embedded ? annex : `${annex}${scheduleText}`;

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
