/**
 * PII masking (spec §9). Without the pii scope (+ people:update), RFC and CURP
 * keep their first 4 characters, NSS and phone their last 4, email its first
 * letter and domain, and the birth date is dropped. Free text (contract text,
 * audit payloads) is scanned for the same identifiers.
 */
const DOT = "•";

const keepStart = (value: string, visible: number) =>
  value.slice(0, visible) + DOT.repeat(Math.max(0, value.length - visible));

const keepEnd = (value: string, visible: number) =>
  DOT.repeat(Math.max(0, value.length - visible)) + value.slice(-visible);

export const maskRfc = (value: string | null | undefined) =>
  value ? keepStart(value, 4) : null;

export const maskCurp = maskRfc;

export const maskNss = (value: string | null | undefined) =>
  value ? keepEnd(value, 4) : null;

export const maskPhone = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? DOT.repeat(digits.length) : keepEnd(digits, 4);
};

export const maskEmail = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const [local, domain] = value.split("@");
  return domain
    ? `${local.slice(0, 1)}${DOT.repeat(3)}@${domain}`
    : DOT.repeat(3);
};

export type PersonPii = {
  rfc: string | null;
  curp: string | null;
  nss: string | null;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: string | null;
};

/** The six PII fields of a person, in clear or masked. */
export const personPii = (person: PersonPii, unmasked: boolean) =>
  unmasked
    ? {
        rfc: person.rfc,
        curp: person.curp,
        nss: person.nss,
        telefono: person.telefono,
        email: person.email,
        fecha_nacimiento: person.fechaNacimiento,
        pii_masked: false,
      }
    : {
        rfc: maskRfc(person.rfc),
        curp: maskCurp(person.curp),
        nss: maskNss(person.nss),
        telefono: maskPhone(person.telefono),
        email: maskEmail(person.email),
        fecha_nacimiento: null,
        pii_masked: true,
      };

// Mexican identifiers inside free text.
const CURP_RE = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi;
const RFC_RE = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi;
const NSS_RE = /\b\d{11}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?52[\s-]?)?\b\d{2,3}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;

/**
 * Masks identifiers found in free text, plus the exact values given (a person's
 * own RFC, CURP… even when they do not match the patterns).
 */
export const maskText = (
  text: string,
  known: Array<string | null | undefined> = [],
) => {
  let result = text;

  for (const value of known) {
    if (value && value.length >= 4) {
      result = result
        .split(value)
        .join(keepStart(value, Math.min(4, value.length - 1)));
    }
  }

  return result
    .replace(CURP_RE, (match) => keepStart(match, 4))
    .replace(RFC_RE, (match) => keepStart(match, 4))
    .replace(EMAIL_RE, (match) => maskEmail(match) ?? match)
    .replace(NSS_RE, (match) => keepEnd(match, 4))
    .replace(PHONE_RE, (match) => maskPhone(match) ?? match);
};

const PII_KEYS = new Set([
  "rfc",
  "curp",
  "nss",
  "telefono",
  "email",
  "fechaNacimiento",
  "fecha_nacimiento",
  // Compensation and expediente México in audit payloads.
  "salarioDiario",
  "salarioMensual",
  "finiquitoMonto",
  "domicilioCalle",
  "domicilioNumeroExterior",
  "domicilioNumeroInterior",
  "domicilioColonia",
  "ineClaveElector",
  "beneficiarios",
]);

/** Masks a JSON value deeply: PII keys by field, strings by pattern. */
export const maskDeep = (value: unknown): unknown => {
  if (typeof value === "string") {
    return maskText(value);
  }

  if (Array.isArray(value)) {
    return value.map(maskDeep);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => {
        if (!PII_KEYS.has(key)) {
          return [key, maskDeep(inner)];
        }

        if (
          inner &&
          typeof inner === "object" &&
          ("from" in inner || "to" in inner)
        ) {
          const change = inner as { from?: unknown; to?: unknown };
          return [
            key,
            {
              from: maskField(key, change.from),
              to: maskField(key, change.to),
            },
          ];
        }

        return [key, maskField(key, inner)];
      }),
    );
  }

  return value;
};

const maskField = (key: string, value: unknown) => {
  // Lists, numbers and objects under a PII key (beneficiaries, salaries) go away entirely.
  if (typeof value !== "string" || value === "") {
    return value === "" ? "" : null;
  }

  switch (key) {
    case "rfc":
    case "curp":
      return maskRfc(value);
    case "nss":
      return maskNss(value);
    case "telefono":
      return maskPhone(value);
    case "email":
      return maskEmail(value);
    default:
      return null;
  }
};
