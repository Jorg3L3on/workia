/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { contractScheduleText } from "@/lib/contracts/schema";
import { missingGlyphs } from "@/lib/contracts/glyphs";
import {
  ContractPdfGlyphError,
  contractPdfPlainText,
  renderContractPdf,
} from "@/lib/contracts/pdf";
import { extractPdfPages, extractPdfText } from "@/test/pdf-text";

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

    expect(extracted).toBe(
      contractPdfPlainText({ generatedText, scheduleText: schedule }),
    );
    expect(extracted).toBe(
      `${generatedText}\n\nANEXO A. HORARIO\n\n${schedule}`,
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
      extractPdfText(
        await renderContractPdf({
          generatedText,
          scheduleText: "—",
        }),
      ),
    ).toBe(contractPdfPlainText({ generatedText, scheduleText: "—" }));
  });
});
