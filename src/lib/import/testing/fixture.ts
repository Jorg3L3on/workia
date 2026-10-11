import ExcelJS from "exceljs";

import { curpCheckDigit } from "@/lib/people/identity";

import { IMPORT_COLUMNS, SHEET_NAMES, type ImportSheetKey } from "../format";

/**
 * Generates large, valid (and optionally broken) import files for scale tests
 * and the e2e suite. Deterministic for a given `run` and `people`.
 */

const CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ";
const AREAS = ["Ventas", "Almacén", "Administración", "Logística"];
const POSITIONS = ["Vendedor", "Almacenista", "Analista", "Chofer"];
const SITES = ["Matriz", "Sucursal Norte", "Sucursal Sur"];

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** Unique valid CURP for a global index (distinct for 4.4 million values). */
export const fixtureCurp = (index: number) => {
  const consonants = [
    index % 20,
    Math.floor(index / 20) % 20,
    Math.floor(index / 400) % 20,
  ]
    .map((digit) => CONSONANTS[digit])
    .join("");
  const month = (Math.floor(index / 8000) % 12) + 1;
  const day = (Math.floor(index / 96000) % 28) + 1;
  const body = `FXTR${pad(40 + (index % 50))}${pad(month)}${pad(day)}HDF${consonants}0`;

  return `${body}${curpCheckDigit(body)}`;
};

const HOMOCLAVE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Unique valid persona-física RFC for a global index. */
export const fixtureRfc = (index: number) => {
  const homoclave = [
    index % 36,
    Math.floor(index / 36) % 36,
    Math.floor(index / 1296) % 36,
  ]
    .map((digit) => HOMOCLAVE[digit])
    .join("");
  const month = (Math.floor(index / 46656) % 12) + 1;

  return `FXTR${pad(60 + (index % 40))}${pad(month)}15${homoclave}`;
};

export type FixtureOptions = {
  people: number;
  /** Distinguishes runs so identifiers never collide across runs. */
  run?: number;
  /** Adds a known number of broken rows. */
  withErrors?: boolean;
  /** Last name shared by every person, handy for filtering exports. */
  lastName?: string;
};

export type FixtureSummary = {
  people: number;
  horarios: number;
  contratos: number;
  /** Rows deliberately broken (only when withErrors). */
  brokenPeople: number;
  brokenContracts: number;
};

type Cell = string | number | null;

export const buildFixtureRows = (options: FixtureOptions) => {
  const run = options.run ?? 1;
  const lastName = options.lastName ?? "Fixture";
  const base = run * 100_000;
  const rows: Record<ImportSheetKey, Record<string, Cell>[]> = {
    personas: [],
    horarios: [],
    contratos: [],
  };
  const summary: FixtureSummary = {
    people: 0,
    horarios: 0,
    contratos: 0,
    brokenPeople: 0,
    brokenContracts: 0,
  };

  // Which rows are deliberately broken; managers never point at one of them,
  // so a seeded error does not cascade into the people who report to it.
  const brokenKind = (i: number) =>
    !options.withErrors
      ? null
      : i % 97 === 5
        ? "invalid"
        : i % 211 === 7 && i > 0
          ? "duplicate"
          : null;

  for (let i = 0; i < options.people; i += 1) {
    const global = base + i;
    const curp = fixtureCurp(global);
    const kind = brokenKind(i);
    const personCurp =
      kind === "invalid"
        ? "CURP-INVALIDA"
        : kind === "duplicate"
          ? fixtureCurp(global - 1) // repeats the previous row
          : curp;
    const broken = kind !== null;
    const managerIsFine = i > 0 && i % 10 === 0 && brokenKind(i - 1) === null;

    rows.personas.push({
      nombres: `Fx${run}N${i}`,
      apellidoPaterno: lastName,
      apellidoMaterno: "Prueba",
      email: `fx${run}.${i}@ejemplo.mx`,
      telefono: `55${pad(i % 100, 2)}${pad(i % 10000, 4)}00`.slice(0, 10),
      fechaNacimiento: `19${60 + (i % 40)}-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}`,
      fechaIngreso: `20${10 + (i % 15)}-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}`,
      area: AREAS[i % AREAS.length],
      puesto: POSITIONS[i % POSITIONS.length],
      sucursal: SITES[i % SITES.length],
      jefeDirecto: managerIsFine ? fixtureCurp(global - 1) : null,
      rfc: fixtureRfc(global),
      curp: personCurp,
      nss: null,
      estatus: "Activa",
    });
    summary.people += 1;

    if (broken) {
      summary.brokenPeople += 1;
    }

    if (i % 5 !== 4) {
      rows.horarios.push({
        curp,
        entrada: "08:00",
        salidaComer: "13:00",
        regresoComer: "14:00",
        salida: "17:00",
      });
      summary.horarios += 1;
    }

    // One in five people carries a three-contract history.
    const history = i % 5 === 0;
    const contracts = history
      ? [
          {
            type: "Determinado",
            start: "2021-01-01",
            end: "2021-12-31",
            status: "Renovado",
          },
          {
            type: "Determinado",
            start: "2022-01-01",
            end: "2022-12-31",
            status: "Renovado",
          },
          {
            type: "Determinado",
            start: "2026-06-01",
            end: "2027-05-31",
            status: "Vigente",
          },
        ]
      : [
          {
            type: "Indeterminado",
            start: "2023-03-01",
            end: null,
            status: "Vigente",
          },
        ];

    contracts.forEach((contract, index) => {
      const brokenContract =
        Boolean(options.withErrors) && i % 331 === 9 && index === 0;

      rows.contratos.push({
        curp,
        tipo: brokenContract ? "Temporal" : contract.type,
        fechaInicio: contract.start,
        fechaFin: contract.end,
        aviso: contract.type === "Determinado" ? "1" : "No avisar",
        estatus: contract.status,
        plantilla: null,
      });
      summary.contratos += 1;

      if (brokenContract) {
        summary.brokenContracts += 1;
      }
    });
  }

  return { rows, summary };
};

/** The fixture as an XLSX buffer in the official template layout. */
export const generateImportFixture = async (options: FixtureOptions) => {
  const { rows, summary } = buildFixtureRows(options);
  const workbook = new ExcelJS.Workbook();

  for (const key of ["personas", "horarios", "contratos"] as ImportSheetKey[]) {
    const columns = IMPORT_COLUMNS[key];
    const sheet = workbook.addWorksheet(SHEET_NAMES[key]);

    sheet.addRow(columns.map((column) => column.label));

    for (const row of rows[key]) {
      sheet.addRow(columns.map((column) => row[column.key] ?? null));
    }
  }

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    summary,
  };
};
