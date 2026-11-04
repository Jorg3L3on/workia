import { curpCheckDigit, sampleCurp } from "@/lib/people/identity";

// Above the demo seed's and the IDOR fixtures' indexes, so a test person never
// collides with them; unique within a test file (one module per file).
let next = 10_000 + Math.floor(Math.random() * 100) * 1_000;

/** A valid CURP no other person of the test run has: every active person needs one. */
export const uniqueCurp = () => sampleCurp(next++);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VOWELS = "AEIOUX";
const CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ";
const STATES = [
  "AS",
  "BC",
  "CH",
  "DF",
  "JC",
  "MC",
  "NL",
  "PL",
  "QT",
  "SP",
  "VZ",
  "YN",
];
const pick = (from: string | string[]) =>
  from[Math.floor(Math.random() * from.length)];

/**
 * A valid CURP drawn at random from billions of values, for tests whose
 * rules span companies (one live employee account per CURP across the
 * group). uniqueCurp() picks one of 100 blocks per file, so two files that
 * both create employee accounts can share a CURP in the same run.
 */
export const randomCurp = () => {
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  const year = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  const base = [
    pick(LETTERS),
    pick(VOWELS),
    pick(LETTERS),
    pick(LETTERS),
    year,
    month,
    day,
    pick("HM"),
    pick(STATES),
    pick(CONSONANTS),
    pick(CONSONANTS),
    pick(CONSONANTS),
    "0",
  ].join("");

  return `${base}${curpCheckDigit(base)}`;
};
