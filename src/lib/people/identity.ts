const CURP_ALPHABET = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

const CURP_PATTERN =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/;

const RFC_PERSONA_FISICA_PATTERN =
  /^[A-ZÑ&]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[0-9A-Z]{3}$/;

const NSS_PATTERN = /^\d{11}$/;

/** Uppercase and strip every whitespace character. */
export const normalizeIdentifier = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

/** Normalized value, or null when the identifier is blank. */
export const identifierOrNull = (value?: string | null) => {
  const normalized = normalizeIdentifier(value);

  return normalized === "" ? null : normalized;
};

export const normalizeCurp = normalizeIdentifier;
export const normalizeRfc = normalizeIdentifier;
export const normalizeNss = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, "");

export const curpCheckDigit = (first17: string) => {
  let sum = 0;

  for (let index = 0; index < 17; index += 1) {
    const value = CURP_ALPHABET.indexOf(first17[index]);

    if (value < 0) {
      return null;
    }

    sum += value * (18 - index);
  }

  return String((10 - (sum % 10)) % 10);
};

export const isValidCurp = (value: string) => {
  const curp = normalizeCurp(value);

  return CURP_PATTERN.test(curp) && curpCheckDigit(curp) === curp[17];
};

const isRealDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** Persona física RFC (13 characters): format and a real birth date. */
export const isValidRfc = (value: string) => {
  const rfc = normalizeRfc(value);

  if (!RFC_PERSONA_FISICA_PATTERN.test(rfc)) {
    return false;
  }

  const yy = Number(rfc.slice(4, 6));
  const month = Number(rfc.slice(6, 8));
  const day = Number(rfc.slice(8, 10));

  // The century is ambiguous in an RFC; a date is valid if either reading is.
  return isRealDate(1900 + yy, month, day) || isRealDate(2000 + yy, month, day);
};

/** IMSS NSS: 11 digits whose last digit is a Luhn check digit. */
export const isValidNss = (value: string) => {
  const nss = normalizeNss(value);

  if (!NSS_PATTERN.test(nss)) {
    return false;
  }

  let sum = 0;

  for (let index = 0; index < 11; index += 1) {
    let digit = Number(nss[index]);

    if (index % 2 === 1) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return sum % 10 === 0;
};

export type IdentityField = "curp" | "rfc";

export class DuplicateIdentityError extends Error {
  constructor(public readonly fields: IdentityField[]) {
    super(`Identificador duplicado: ${fields.join(", ")}`);
    this.name = "DuplicateIdentityError";
  }
}
