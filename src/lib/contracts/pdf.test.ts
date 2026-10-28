/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { contractScheduleText } from "@/lib/contracts/schema";
import { missingGlyphs } from "@/lib/contracts/glyphs";
import {
  ContractPdfGlyphError,
  contractPdfPlainText,
  groupLines,
  renderContractPdf,
} from "@/lib/contracts/pdf";
import {
  extractPdfMarks,
  extractPdfPages,
  extractPdfText,
} from "@/test/pdf-text";

/** Signature columns are drawn in a row; the copy keeps a double space. */
const printed = (value: string) => value.replace(/ {2,}/g, "  ");

const schedule = contractScheduleText({
  scheduleEntrada: "08:00",
  scheduleSalidaComer: null,
  scheduleRegresoComer: null,
  scheduleSalida: "17:00",
  scheduleBlocks: [
    {
      dias: ["lun", "mie", "vie"],
      entrada: "08:00",
      salida: "17:00",
      comidaInicio: null,
      comidaFin: null,
    },
  ],
  scheduleRestDay: "sab",
});

const signature = [
  "______________________________          ______________________________",
  "LA EMPRESA                               LA PERSONA TRABAJADORA",
  "Parte genérica                           Otra parte genérica",
].join("\n");

describe("contract PDF", () => {
  it("lists glyphs Noto Sans cannot draw and keeps the ones it can", () => {
    expect(missingGlyphs("año ñ № Ł ✓ 李")).toEqual(["✓", "李"]);
    expect(missingGlyphs("\t")).toEqual(["\t"]);
  });

  it("fails visibly when the text uses glyphs the font does not cover", async () => {
    const generatedText = "Cláusula con ✓ y 李.";

    await expect(
      renderContractPdf({ generatedText, scheduleText: schedule }),
    ).rejects.toThrow(ContractPdfGlyphError);

    try {
      await renderContractPdf({ generatedText, scheduleText: schedule });
    } catch (error) {
      expect(error).toBeInstanceOf(ContractPdfGlyphError);
      expect((error as ContractPdfGlyphError).message).toContain("✓");
      expect((error as ContractPdfGlyphError).message).toContain("李");
      expect((error as ContractPdfGlyphError).missing).toEqual(["✓", "李"]);
    }
  });

  it("prints accents, ñ, № and Ł, then the schedule annex", async () => {
    const generatedText = [
      "Contrato con acentos áéíóú ÁÉÍÓÚ, eñe ñ Ñ, signo № y letra Ł.",
      "",
      "Este párrafo es deliberadamente largo para ocupar más de un renglón de la página carta y comprobar que el salto visual no pierde el espacio, la eñe ñ ni los acentos áéíóú del texto guardado.",
      "Periodo de prueba de 30 días.",
      "",
      signature,
    ].join("\n");
    const file = await renderContractPdf({
      generatedText,
      scheduleText: schedule,
    });
    const extracted = extractPdfText(file);

    expect(printed(extracted)).toBe(
      printed(contractPdfPlainText({ generatedText, scheduleText: schedule })),
    );
    expect(printed(extracted)).toBe(
      printed(`${generatedText}\n\nANEXO A. HORARIO\n\n${schedule}`),
    );
    expect(extracted).toContain("30 días");
    expect(extracted).not.toContain("90");
    expect(extracted).toContain("Mié");
    expect(file.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("starts an annex already in the text on a new page without repeating it", async () => {
    const generatedText = [
      "Cláusula con ñ.",
      "",
      "ANEXO A. HORARIO",
      "",
      "Lun, Mié 09:00–17:00",
    ].join("\n");
    const extracted = extractPdfText(
      await renderContractPdf({
        generatedText,
        scheduleText: "otro horario que no debe imprimirse",
      }),
    );

    expect(extracted).toBe(generatedText);
    expect(extracted.match(/ANEXO A/g)).toHaveLength(1);
    expect(extracted).not.toContain("otro horario");
  });

  it("keeps a long contract's signature lines on the same page", async () => {
    const filler = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `Linea ${String(index).padStart(3, "0")} con ene y eñe.`,
      ).join("\n");
    const probe = extractPdfPages(
      await renderContractPdf({
        generatedText: filler(80),
        scheduleText: "—",
      }),
    );
    const perPage = probe[0]?.split("\n").length ?? 0;
    const bodyCount = perPage - 1;
    const generatedText = `${filler(bodyCount)}\n${signature}`;
    const pages = extractPdfPages(
      await renderContractPdf({
        generatedText,
        scheduleText: "—",
      }),
    );
    const signaturePages = pages
      .map((page, index) =>
        page.includes("______________________________") ? index : -1,
      )
      .filter((index) => index >= 0);
    const signaturePage = pages[signaturePages[0] ?? -1] ?? "";

    expect(perPage).toBeGreaterThan(10);
    expect(signaturePages).toEqual([1]);
    expect(signaturePage).toContain("LA EMPRESA");
    expect(signaturePage).toContain("LA PERSONA TRABAJADORA");
    expect(signaturePage).toContain("Parte genérica");
    expect(signaturePage).not.toContain(
      `Linea ${String(bodyCount - 1).padStart(3, "0")}`,
    );
    expect(
      printed(
        extractPdfText(
          await renderContractPdf({
            generatedText,
            scheduleText: "—",
          }),
        ),
      ),
    ).toBe(printed(contractPdfPlainText({ generatedText, scheduleText: "—" })));
  });

  it("finishes when a signature line also contains the annex marker", () => {
    expect(groupLines(["ANEXO A ________________"])).toEqual([
      { signature: true, lines: ["ANEXO A ________________"] },
    ]);
    expect(
      groupLines(["Cláusula.", "Firma ANEXO A ____________", "LA EMPRESA"]),
    ).toEqual([
      { signature: false, lines: ["Cláusula."] },
      {
        signature: true,
        lines: ["Firma ANEXO A ____________", "LA EMPRESA"],
      },
    ]);
  });

  it("prints the schedule when ANEXO A is only mentioned mid-sentence", async () => {
    const generatedText = [
      "El horario queda conforme al ANEXO A de este contrato.",
      "ANEXO AB no es el encabezado del horario.",
      "",
      "Firma ANEXO A ____________",
    ].join("\n");
    const extracted = extractPdfText(
      await renderContractPdf({ generatedText, scheduleText: schedule }),
    );

    expect(printed(extracted)).toBe(
      printed(`${generatedText}\n\nANEXO A. HORARIO\n\n${schedule}`),
    );
    expect(extracted).toContain("Mié");
    expect(extracted).toContain("Firma ANEXO A ____________");
  });

  it("turns tabs into spaces instead of dropping them", async () => {
    const generatedText = "Columna\tinicial y eñe ñ.";
    const extracted = extractPdfText(
      await renderContractPdf({ generatedText, scheduleText: "—" }),
    );

    expect(extracted).toBe(
      contractPdfPlainText({ generatedText, scheduleText: "—" }),
    );
    expect(extracted).toContain("Columna    inicial");
    expect(extracted).not.toContain("\t");
  });

  it("keeps a lone right-column name on the right", async () => {
    const rule =
      "______________________________          ______________________________";
    const generatedText = [
      rule,
      "                                        Solo derecha",
    ].join("\n");
    const marks = extractPdfMarks(
      await renderContractPdf({ generatedText, scheduleText: "—" }),
    ).flat();
    const rules = marks
      .filter((mark) => mark.text.startsWith("___"))
      .sort((left, right) => left.x - right.x);
    const name = marks.find((mark) => mark.text.includes("Solo derecha"));
    const left = rules[0];
    const right = rules.at(-1);

    expect(name && left && right).toBeTruthy();
    expect(Math.abs((name?.x ?? 0) - (right?.x ?? 0))).toBeLessThan(8);
    expect((name?.x ?? 0) - (left?.x ?? 0)).toBeGreaterThan(80);
  });

  it("places each signature name under its own line", async () => {
    const file = await renderContractPdf({
      generatedText: signature,
      scheduleText: "—",
    });
    const marks = extractPdfMarks(file).flat();
    const rules = marks
      .filter((mark) => mark.text.startsWith("___"))
      .sort((left, right) => left.x - right.x);
    const empresa = marks.find((mark) => mark.text === "LA EMPRESA");
    const persona = marks.find(
      (mark) => mark.text === "LA PERSONA TRABAJADORA",
    );
    const left = rules[0];
    const right = rules.at(-1);

    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(left && right && empresa && persona).toBeTruthy();
    expect(Math.abs((empresa?.x ?? 0) - (left?.x ?? 0))).toBeLessThan(8);
    expect(Math.abs((persona?.x ?? 0) - (right?.x ?? 0))).toBeLessThan(8);
    expect((persona?.y ?? 0) < (left?.y ?? 0)).toBe(true);
    expect((right?.x ?? 0) - (left?.x ?? 0)).toBeGreaterThan(80);
  });

  it("splits a signature taller than one page instead of overflowing", async () => {
    const rows = Array.from({ length: 70 }, (_, index) => {
      const label = String(index).padStart(2, "0");
      return `Firmante ${label}                    Testigo ${label}`;
    });
    const generatedText = [signature.split("\n")[0], ...rows].join("\n");
    const file = await renderContractPdf({
      generatedText,
      scheduleText: "—",
    });
    const pages = extractPdfPages(file);
    const last = "Testigo 69";

    expect(extractPdfText(file)).toContain(last);
    expect(pages[0]).not.toContain(last);
    expect(pages.some((page) => page.includes(last))).toBe(true);
  });
});
