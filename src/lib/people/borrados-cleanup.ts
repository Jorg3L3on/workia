/**
 * Dummy-only rules for cleaning test residue in Personas → Borrados.
 * Never targets live seed company people still in the active expediente.
 */

export type BorradosCleanupPerson = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string | null;
  email?: string | null;
  deletedAt?: Date | string | null;
};

export const OFFICIAL_DELETED_DEMO_PERSON = {
  nombres: "Persona",
  apellidoPaterno: "Borrada",
  apellidoMaterno: "Recorrido",
  email: "persona.borrada.recorrido@ejemplo.local",
  rfc: "XAXX01010100B",
  curp: "XAXX010101HDFXXX0B",
  nss: "99999999900",
} as const;

export const OFFICIAL_DELETED_DEMO_FULL_NAME = [
  OFFICIAL_DELETED_DEMO_PERSON.nombres,
  OFFICIAL_DELETED_DEMO_PERSON.apellidoPaterno,
  OFFICIAL_DELETED_DEMO_PERSON.apellidoMaterno,
].join(" ");

const LIVE_SEED_SURNAMES = new Set(["Demo", "Ejemplo", "Muestra"]);

const E2E_BORRADA_DEMO_SUFFIX = /^persona\s+borrada\s+demo\s*\d+$/i;
const PRUEBA_TOKEN = /prueba/i;
const BORRAR_DEMO_SUFFIX = /borra\w*\s+demo\s*\d+/i;
const DEMO_NUMERIC_SUFFIX = /demo\s*\d{3,}/i;

const normalizePart = (value?: string | null) => value?.trim() ?? "";

export const formatBorradosCleanupName = (person: BorradosCleanupPerson) =>
  [person.nombres, person.apellidoPaterno, person.apellidoMaterno]
    .map(normalizePart)
    .filter(Boolean)
    .join(" ");

export const isOfficialDeletedDemoPerson = (person: BorradosCleanupPerson) => {
  const sameName =
    normalizePart(person.nombres) === OFFICIAL_DELETED_DEMO_PERSON.nombres &&
    normalizePart(person.apellidoPaterno) ===
      OFFICIAL_DELETED_DEMO_PERSON.apellidoPaterno &&
    normalizePart(person.apellidoMaterno) ===
      OFFICIAL_DELETED_DEMO_PERSON.apellidoMaterno;

  const sameEmail =
    normalizePart(person.email).toLowerCase() ===
    OFFICIAL_DELETED_DEMO_PERSON.email;

  return sameName || sameEmail;
};

export const isLiveSeedCompanyPerson = (person: BorradosCleanupPerson) => {
  if (person.deletedAt) {
    return false;
  }

  const surnames = [
    normalizePart(person.apellidoPaterno),
    normalizePart(person.apellidoMaterno),
  ];

  return surnames.some((surname) => LIVE_SEED_SURNAMES.has(surname));
};

const matchesResidueNamePattern = (person: BorradosCleanupPerson) => {
  const fullName = formatBorradosCleanupName(person);
  const haystack = [
    fullName,
    normalizePart(person.nombres),
    normalizePart(person.apellidoPaterno),
    normalizePart(person.apellidoMaterno),
    normalizePart(person.email),
  ].join(" ");

  return (
    E2E_BORRADA_DEMO_SUFFIX.test(fullName) ||
    PRUEBA_TOKEN.test(haystack) ||
    BORRAR_DEMO_SUFFIX.test(haystack) ||
    DEMO_NUMERIC_SUFFIX.test(haystack)
  );
};

export const isSoftDeletedTestResidue = (person: BorradosCleanupPerson) => {
  if (!person.deletedAt) {
    return false;
  }

  if (isOfficialDeletedDemoPerson(person)) {
    return false;
  }

  if (isLiveSeedCompanyPerson(person)) {
    return false;
  }

  return matchesResidueNamePattern(person);
};

export const selectSoftDeletedResidue = <T extends BorradosCleanupPerson>(
  people: T[],
) => people.filter((person) => isSoftDeletedTestResidue(person));
