import { describe, expect, it } from "vitest";

import {
  activePersonLacksCurp,
  assertActivePersonHasCurp,
  curpCheckDigit,
  identifierOrNull,
  isValidCurp,
  isValidNss,
  isValidRfc,
  MissingCurpError,
  normalizeIdentifier,
  sampleCurp,
} from "./identity";

describe("normalizeIdentifier", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeIdentifier(" xaxx 0101 01 000 ")).toBe("XAXX010101000");
  });

  it("returns null for blank values", () => {
    expect(identifierOrNull("   ")).toBeNull();
    expect(identifierOrNull(undefined)).toBeNull();
  });
});

describe("isValidCurp", () => {
  it("accepts a CURP with a correct check digit", () => {
    const base = "HEGG560427MVZRRL0";
    const curp = `${base}${curpCheckDigit(base)}`;

    expect(isValidCurp(curp)).toBe(true);
    expect(isValidCurp(curp.toLowerCase())).toBe(true);
  });

  it("rejects a wrong check digit, bad dates and bad length", () => {
    const base = "HEGG560427MVZRRL0";
    const good = curpCheckDigit(base)!;
    const bad = String((Number(good) + 1) % 10);

    expect(isValidCurp(`${base}${bad}`)).toBe(false);
    expect(isValidCurp("HEGG561327MVZRRL04")).toBe(false);
    expect(isValidCurp("HEGG560427MVZRRL")).toBe(false);
  });
});

describe("isValidRfc", () => {
  it("accepts persona física RFCs, including the generic one", () => {
    expect(isValidRfc("XAXX010101000")).toBe(true);
    expect(isValidRfc("vecj 880326 xxx")).toBe(true);
  });

  it("rejects bad format and impossible dates", () => {
    expect(isValidRfc("XAXX011301000")).toBe(false);
    expect(isValidRfc("XAXX0101010")).toBe(false);
    expect(isValidRfc("1AXX010101000")).toBe(false);
  });
});

describe("isValidNss", () => {
  it("accepts exactly one check digit for a given 10-digit body", () => {
    const valid = Array.from(
      { length: 10 },
      (_, check) => `1234567890${check}`,
    ).filter(isValidNss);

    expect(valid).toHaveLength(1);
  });

  it("rejects non-numeric and wrong length", () => {
    expect(isValidNss("1234")).toBe(false);
    expect(isValidNss("1234567890A")).toBe(false);
  });
});

describe("identity model: active people carry a CURP (P-00)", () => {
  it("flags an active, live person without a valid CURP", () => {
    expect(activePersonLacksCurp({ status: "activa", curp: null })).toBe(true);
    expect(activePersonLacksCurp({ status: "activa", curp: "NOPE" })).toBe(
      true,
    );
    expect(
      activePersonLacksCurp({ status: "activa", curp: sampleCurp(3) }),
    ).toBe(false);
  });

  it("lets a baja or a borrado keep a blank CURP", () => {
    expect(activePersonLacksCurp({ status: "baja", curp: null })).toBe(false);
    expect(
      activePersonLacksCurp({
        status: "activa",
        curp: null,
        deletedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("throws MissingCurpError on the curp field", () => {
    expect(() =>
      assertActivePersonHasCurp({ status: "activa", curp: "" }),
    ).toThrow(MissingCurpError);
  });

  it("makes distinct valid sample CURPs", () => {
    const indexes = [0, 1, 19, 20, 7999, 8000, 123_456, 799_999];
    const curps = indexes.map(sampleCurp);

    expect(curps.every(isValidCurp)).toBe(true);
    expect(new Set(curps).size).toBe(indexes.length);
    // The demo seed's identifiers stay as they were.
    expect(sampleCurp(0)).toBe(
      "XAXX010101HDFBBB0" + curpCheckDigit("XAXX010101HDFBBB0"),
    );
  });
});
