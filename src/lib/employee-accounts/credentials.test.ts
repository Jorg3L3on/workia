import { describe, expect, it } from "vitest";

import {
  generateActivationCode,
  generateLoginCode,
  generateSessionToken,
  hashesMatch,
  hashSecret,
  isPlausibleEmail,
  normalizeActivationCode,
  normalizeEmail,
  normalizeLoginCode,
} from "./credentials";

describe("employee credentials", () => {
  it("normalizes emails to trimmed lower case", () => {
    expect(normalizeEmail("  Ana.Lopez@Empresa.MX ")).toBe(
      "ana.lopez@empresa.mx",
    );
    expect(isPlausibleEmail("ana@empresa.mx")).toBe(true);
    expect(isPlausibleEmail("ana@empresa")).toBe(false);
    expect(isPlausibleEmail("ana empresa.mx")).toBe(false);
  });

  it("makes six-digit login codes and reads them with spaces or dashes", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateLoginCode()).toMatch(/^\d{6}$/);
    }

    expect(normalizeLoginCode("123 456")).toBe("123456");
    expect(normalizeLoginCode("123-456")).toBe("123456");
  });

  it("makes activation codes without look-alike characters", () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateActivationCode();

      expect(code).toMatch(
        /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/,
      );
      expect(normalizeActivationCode(code.toLowerCase())).toBe(
        code.replace(/-/g, ""),
      );
    }
  });

  it("stores an HMAC per kind, never the secret", () => {
    const code = "123456";
    const login = hashSecret("login", code, "s".repeat(32));

    expect(login).not.toContain(code);
    expect(login).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret("activation", code, "s".repeat(32))).not.toBe(login);
    expect(hashSecret("login", code, "t".repeat(32))).not.toBe(login);
    expect(hashesMatch(login, hashSecret("login", code, "s".repeat(32)))).toBe(
      true,
    );
    expect(
      hashesMatch(login, hashSecret("login", "654321", "s".repeat(32))),
    ).toBe(false);
    expect(hashesMatch(login, "")).toBe(false);
  });

  it("makes long random session tokens", () => {
    const token = generateSessionToken();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(generateSessionToken()).not.toBe(token);
  });
});
