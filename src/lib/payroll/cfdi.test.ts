import { describe, expect, it } from "vitest";

import { sampleCfdiNomina } from "@/test/cfdi";

import { parseCfdiNomina } from "./cfdi";
import { pairReceiptFiles } from "./pairing";

describe("parseCfdiNomina", () => {
  it("reads the timbre UUID, receptor and nómina identifiers", () => {
    const uuid = "A1F3C2D4-1111-4222-8333-944455556666";
    const result = parseCfdiNomina(sampleCfdiNomina({ uuid }));

    expect(result).toEqual({
      ok: true,
      value: {
        uuid: uuid.toLowerCase(),
        emisorRfc: "EKU9003173C9",
        receptorRfc: "PEGJ800101AB1",
        receptorName: "JUAN PÉREZ GARCÍA & HNOS",
        curp: "PEGJ800101HDFRRN09",
        numEmpleado: "00123",
        tipoNomina: "O",
        paymentDate: "2026-10-31",
        periodStart: "2026-10-16",
        periodEnd: "2026-10-31",
      },
    });
  });

  it("resolves the nómina namespace whatever its prefix", () => {
    const result = parseCfdiNomina(sampleCfdiNomina({ nominaPrefix: "n12" }));

    expect(result.ok && result.value.curp).toBe("PEGJ800101HDFRRN09");
  });

  it("keeps a receipt without CURP or NumEmpleado matchable by RFC", () => {
    const result = parseCfdiNomina(
      sampleCfdiNomina({ curp: null, numEmpleado: null }),
    );

    expect(result.ok && result.value).toMatchObject({
      curp: null,
      numEmpleado: null,
      receptorRfc: "PEGJ800101AB1",
    });
  });

  it("drops a CURP that is not one", () => {
    const result = parseCfdiNomina(sampleCfdiNomina({ curp: "NO-ES-CURP" }));

    expect(result.ok && result.value.curp).toBeNull();
  });

  it("refuses what is not a stamped CFDI de nómina", () => {
    expect(parseCfdiNomina("<factura/>")).toEqual({
      ok: false,
      error: "not_cfdi",
    });
    expect(
      parseCfdiNomina(
        sampleCfdiNomina().replace(
          'TipoDeComprobante="N"',
          'TipoDeComprobante="I"',
        ),
      ),
    ).toEqual({ ok: false, error: "not_nomina" });
    expect(
      parseCfdiNomina(sampleCfdiNomina().replace(/UUID="[^"]+"/, "")),
    ).toEqual({ ok: false, error: "no_uuid" });
  });

  it("never reads an amount", () => {
    const result = parseCfdiNomina(sampleCfdiNomina());

    expect(Object.keys(result.ok ? result.value : {})).not.toEqual(
      expect.arrayContaining(["total", "subTotal", "importe"]),
    );
  });
});

describe("pairReceiptFiles", () => {
  it("pairs each XML with the PDF of the same name, across folders and case", () => {
    const result = pairReceiptFiles([
      { path: "periodo/A1.xml", size: 1 },
      { path: "pdf/a1.PDF", size: 2 },
      { path: "B2.xml", size: 3 },
      { path: "C3.pdf", size: 4 },
      { path: "__MACOSX/._A1.xml", size: 5 },
      { path: "notas.txt", size: 6 },
    ]);

    expect(result.pairs).toEqual([
      {
        name: "A1",
        xml: { path: "periodo/A1.xml", size: 1 },
        pdf: { path: "pdf/a1.PDF", size: 2 },
      },
      { name: "B2", xml: { path: "B2.xml", size: 3 }, pdf: null },
    ]);
    expect(result.orphanPdfs).toEqual([{ path: "C3.pdf", size: 4 }]);
    expect(result.ignored.map((entry) => entry.path)).toEqual([
      "__MACOSX/._A1.xml",
      "notas.txt",
    ]);
  });
});
