import { describe, expect, it } from "vitest";

import {
  maskDeep,
  maskEmail,
  maskNss,
  maskPhone,
  maskRfc,
  maskText,
  personPii,
} from "./mask";

describe("PII masking (spec §9)", () => {
  it("keeps the first 4 of RFC and CURP, the last 4 of NSS and phone", () => {
    expect(maskRfc("LORA800101AB1")).toBe("LORA•••••••••");
    expect(maskNss("12345678901")).toBe("•••••••8901");
    expect(maskPhone("961 123 4521")).toBe("••••••4521");
    expect(maskEmail("ana.lopez@ejemplo.mx")).toBe("a•••@ejemplo.mx");
  });

  it("drops the birth date and flags pii_masked", () => {
    const masked = personPii(
      {
        rfc: "LORA800101AB1",
        curp: "LORA800101MCSPZN09",
        nss: "12345678901",
        telefono: "9611234521",
        email: "ana@ejemplo.mx",
        fechaNacimiento: "1980-01-01",
      },
      false,
    );

    expect(masked).toMatchObject({ fecha_nacimiento: null, pii_masked: true });
    expect(JSON.stringify(masked)).not.toContain("LORA800101AB1");
    expect(JSON.stringify(masked)).not.toContain("12345678901");
  });

  it("returns everything in clear when unmasked", () => {
    expect(
      personPii(
        {
          rfc: "X",
          curp: null,
          nss: null,
          telefono: null,
          email: null,
          fechaNacimiento: "1980-01-01",
        },
        true,
      ),
    ).toMatchObject({
      rfc: "X",
      fecha_nacimiento: "1980-01-01",
      pii_masked: false,
    });
  });

  it("masks identifiers inside free text (contract text)", () => {
    const text =
      "Contrato de Ana, RFC LORA800101AB1, CURP LORA800101MCSPZN09, NSS 12345678901, correo ana@ejemplo.mx, tel 961 123 4521.";
    const masked = maskText(text);

    for (const secret of [
      "LORA800101AB1",
      "LORA800101MCSPZN09",
      "12345678901",
      "ana@ejemplo.mx",
      "961 123 4521",
    ]) {
      expect(masked).not.toContain(secret);
    }
    expect(masked).toContain("Contrato de Ana");
  });

  it("masks known values that do not match the patterns", () => {
    expect(maskText("RFC: XAXX-RARO-1", ["XAXX-RARO-1"])).not.toContain(
      "XAXX-RARO-1",
    );
  });

  it("masks audit payloads deeply (before/after/changes)", () => {
    const payload = maskDeep({
      summary: "Edición de LORA800101AB1",
      before: {
        rfc: "LORA800101AB1",
        nombres: "Ana",
        fechaNacimiento: "1980-01-01",
      },
      changes: { nss: { from: "12345678901", to: "10987654321" } },
    });
    const json = JSON.stringify(payload);

    expect(json).not.toContain("LORA800101AB1");
    expect(json).not.toContain("12345678901");
    expect(json).not.toContain("10987654321");
    expect(json).not.toContain("1980-01-01");
    expect(json).toContain("Ana");
  });
});

it("drops non-text PII in payloads (beneficiaries, salaries)", () => {
  const masked = JSON.stringify(
    maskDeep({
      after: {
        salarioDiario: "450.00",
        beneficiarios: ["Ana (Hija, 100 %)"],
        ineClaveElector: "ABCDEF12345678H100",
      },
      changes: { salarioMensual: { from: 1, to: 2 } },
    }),
  );

  expect(masked).not.toContain("450");
  expect(masked).not.toContain("Ana (Hija");
  expect(masked).not.toContain("ABCDEF12345678H100");
});
