import { parseFlexibleDateToIso, toIsoDate } from "@/lib/format/date";

/**
 * Personas import/export file format. Shared by the template, the browser
 * reader, the server validator and the exporter, so it must stay free of
 * server-only imports. The human-readable spec is docs/personas-import-format.md.
 */

export const IMPORT_SHEETS = ["personas", "horarios", "contratos"] as const;
export type ImportSheetKey = (typeof IMPORT_SHEETS)[number];

export const SHEET_NAMES: Record<ImportSheetKey, string> = {
  personas: "Personas",
  horarios: "Horarios",
  contratos: "Contratos",
};

export const INSTRUCTIONS_SHEET_NAME = "Instrucciones";
export const CATALOGS_SHEET_NAME = "Catálogos";

export const IMPORT_LIMITS = {
  maxRows: 5000,
  maxFileBytes: 10 * 1024 * 1024,
  chunkRows: 500,
} as const;

export type ColumnKind = "text" | "date" | "time" | "list";

export type ImportColumn = {
  key: string;
  /** Canonical header written in templates and exports. */
  label: string;
  /** Extra accepted headers; label and key are always accepted. */
  aliases: string[];
  kind: ColumnKind;
  required?: boolean;
  /** Short help shown in the Instrucciones sheet. */
  help: string;
  width: number;
  /** Fixed values (list columns) or the catalog it is validated against. */
  options?: readonly string[];
  catalog?: "areas" | "positions" | "sites" | "templates";
};

export const PERSON_STATUS_OPTIONS = ["Activa", "Baja"] as const;
export const CONTRACT_TYPE_OPTIONS = ["Determinado", "Indeterminado"] as const;
export const NOTICE_OPTIONS = ["1", "2", "3", "6", "No avisar"] as const;
export const CONTRACT_STATUS_OPTIONS = [
  "Vigente",
  "Renovado",
  "No renovado",
  "Vencido",
] as const;

export const IMPORT_COLUMNS: Record<ImportSheetKey, ImportColumn[]> = {
  personas: [
    {
      key: "idWorkia",
      label: "ID Workia",
      aliases: ["id", "id_workia", "workia id"],
      kind: "text",
      help: "Identificador de Workia. Déjalo vacío para personas nuevas; viene lleno en una exportación.",
      width: 38,
    },
    {
      key: "nombres",
      label: "Nombres",
      aliases: ["nombre", "nombre(s)", "first name"],
      kind: "text",
      required: true,
      help: "Obligatorio.",
      width: 22,
    },
    {
      key: "apellidoPaterno",
      label: "Apellido paterno",
      aliases: ["apellido_paterno", "primer apellido", "paterno"],
      kind: "text",
      required: true,
      help: "Obligatorio.",
      width: 20,
    },
    {
      key: "apellidoMaterno",
      label: "Apellido materno",
      aliases: ["apellido_materno", "segundo apellido", "materno"],
      kind: "text",
      help: "Opcional.",
      width: 20,
    },
    {
      key: "email",
      label: "Correo electrónico",
      aliases: ["correo", "email", "e-mail", "mail"],
      kind: "text",
      help: "Opcional.",
      width: 28,
    },
    {
      key: "telefono",
      label: "Teléfono",
      aliases: ["tel", "celular", "phone"],
      kind: "text",
      help: "Opcional.",
      width: 16,
    },
    {
      key: "fechaNacimiento",
      label: "Fecha de nacimiento",
      aliases: ["fecha_nacimiento", "nacimiento", "birth date"],
      kind: "date",
      help: "AAAA-MM-DD, DD/MM/AAAA o fecha de Excel.",
      width: 20,
    },
    {
      key: "fechaIngreso",
      label: "Fecha de ingreso",
      aliases: ["fecha_ingreso", "ingreso", "alta"],
      kind: "date",
      help: "AAAA-MM-DD, DD/MM/AAAA o fecha de Excel.",
      width: 18,
    },
    {
      key: "area",
      label: "Área",
      aliases: ["area", "departamento"],
      kind: "list",
      catalog: "areas",
      help: "Nombre exacto de un área del catálogo.",
      width: 22,
    },
    {
      key: "puesto",
      label: "Puesto",
      aliases: ["position", "posicion", "posición", "cargo"],
      kind: "list",
      catalog: "positions",
      help: "Nombre exacto de un puesto del catálogo.",
      width: 24,
    },
    {
      key: "sucursal",
      label: "Sucursal",
      aliases: ["sitio", "site", "ubicacion", "ubicación"],
      kind: "list",
      catalog: "sites",
      help: "Nombre exacto de una sucursal del catálogo.",
      width: 22,
    },
    {
      key: "jefeDirecto",
      label: "Jefe directo (CURP)",
      aliases: [
        "jefe_directo",
        "jefe directo",
        "jefe",
        "manager",
        "jefe directo (curp o id workia)",
      ],
      kind: "text",
      help: "CURP o ID Workia de otra fila del archivo o de una persona existente.",
      width: 24,
    },
    {
      key: "rfc",
      label: "RFC",
      aliases: [],
      kind: "text",
      help: "13 caracteres, persona física.",
      width: 16,
    },
    {
      key: "curp",
      label: "CURP",
      aliases: [],
      kind: "text",
      help: "18 caracteres con dígito verificador.",
      width: 22,
    },
    {
      key: "nss",
      label: "NSS",
      aliases: ["numero seguro social", "imss"],
      kind: "text",
      help: "11 dígitos.",
      width: 16,
    },
    {
      key: "estatus",
      label: "Estatus",
      aliases: ["estado", "status"],
      kind: "list",
      options: PERSON_STATUS_OPTIONS,
      help: "Activa o Baja. Vacío equivale a Activa.",
      width: 12,
    },
  ],
  horarios: [
    {
      key: "idWorkia",
      label: "ID Workia",
      aliases: ["id", "id_workia", "workia id"],
      kind: "text",
      help: "Persona a la que pertenece el horario (ID Workia o CURP; al menos uno).",
      width: 38,
    },
    {
      key: "curp",
      label: "CURP",
      aliases: [],
      kind: "text",
      help: "Persona a la que pertenece el horario (ID Workia o CURP; al menos uno).",
      width: 22,
    },
    {
      key: "entrada",
      label: "Entrada",
      aliases: ["hora entrada", "horario entrada"],
      kind: "time",
      help: "HH:MM, 24 horas.",
      width: 12,
    },
    {
      key: "salidaComer",
      label: "Salida a comer",
      aliases: ["salida_comer", "salida comer", "inicio comida"],
      kind: "time",
      help: "HH:MM, 24 horas.",
      width: 16,
    },
    {
      key: "regresoComer",
      label: "Regreso de comer",
      aliases: ["regreso_comer", "regreso comer", "fin comida"],
      kind: "time",
      help: "HH:MM, 24 horas.",
      width: 18,
    },
    {
      key: "salida",
      label: "Salida",
      aliases: ["hora salida", "horario salida"],
      kind: "time",
      help: "HH:MM, 24 horas.",
      width: 12,
    },
  ],
  contratos: [
    {
      key: "idWorkia",
      label: "ID Workia",
      aliases: ["id", "id_workia", "workia id"],
      kind: "text",
      help: "Persona del contrato (ID Workia o CURP; al menos uno).",
      width: 38,
    },
    {
      key: "curp",
      label: "CURP",
      aliases: [],
      kind: "text",
      help: "Persona del contrato (ID Workia o CURP; al menos uno).",
      width: 22,
    },
    {
      key: "tipo",
      label: "Tipo",
      aliases: ["tipo de contrato", "tipo_contrato", "type"],
      kind: "list",
      required: true,
      options: CONTRACT_TYPE_OPTIONS,
      help: "Determinado o Indeterminado.",
      width: 16,
    },
    {
      key: "fechaInicio",
      label: "Fecha de inicio",
      aliases: ["fecha_inicio", "inicio"],
      kind: "date",
      required: true,
      help: "Obligatoria.",
      width: 16,
    },
    {
      key: "fechaFin",
      label: "Fecha de fin",
      aliases: ["fecha_fin", "fin", "termino", "término"],
      kind: "date",
      help: "Obligatoria si el contrato es determinado.",
      width: 16,
    },
    {
      key: "aviso",
      label: "Aviso (meses)",
      aliases: ["aviso", "ventana de aviso", "notice"],
      kind: "list",
      options: NOTICE_OPTIONS,
      help: "Meses de anticipación del aviso de renovación, o No avisar.",
      width: 14,
    },
    {
      key: "estatus",
      label: "Estatus",
      aliases: ["estado", "status"],
      kind: "list",
      options: CONTRACT_STATUS_OPTIONS,
      help: "Vigente, Renovado, No renovado o Vencido. Vacío se deduce de las fechas.",
      width: 14,
    },
    {
      key: "plantilla",
      label: "Plantilla",
      aliases: ["plantilla de contrato", "template"],
      kind: "list",
      catalog: "templates",
      help: "Opcional. Si falta, se guarda como contrato importado.",
      width: 24,
    },
  ],
};

/** Lower-case, accent-free, alphanumeric-only form used to compare headers. */
export const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const headerIndex = (sheet: ImportSheetKey) => {
  const index = new Map<string, string>();

  for (const column of IMPORT_COLUMNS[sheet]) {
    for (const name of [column.key, column.label, ...column.aliases]) {
      index.set(normalizeHeader(name), column.key);
    }
  }

  return index;
};

export type HeaderMapping = {
  /** Column position in the file -> column key. */
  mapped: Record<number, string>;
  /** Headers that matched no known column. */
  unknown: { index: number; header: string }[];
  /** Headers that resolved to a column key another header already took. */
  duplicates: { index: number; header: string; key: string }[];
  /** Required columns with no header in the file. */
  missingRequired: string[];
};

/** Proposes the column mapping for a sheet from its header row. */
export const mapHeaders = (
  sheet: ImportSheetKey,
  headers: readonly unknown[],
): HeaderMapping => {
  const index = headerIndex(sheet);
  const mapped: Record<number, string> = {};
  const taken = new Set<string>();
  const unknown: HeaderMapping["unknown"] = [];
  const duplicates: HeaderMapping["duplicates"] = [];

  headers.forEach((header, position) => {
    const text = String(header ?? "").trim();

    if (!text) {
      return;
    }

    const key = index.get(normalizeHeader(text));

    if (!key) {
      unknown.push({ index: position, header: text });
    } else if (taken.has(key)) {
      duplicates.push({ index: position, header: text, key });
    } else {
      taken.add(key);
      mapped[position] = key;
    }
  });

  const missingRequired = IMPORT_COLUMNS[sheet]
    .filter((column) => column.required && !taken.has(column.key))
    .map((column) => column.key);

  return { mapped, unknown, duplicates, missingRequired };
};

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Parses a cell into `YYYY-MM-DD`. Accepts ISO, DD/MM/YYYY, JS dates (as the
 * Excel readers return them) and Excel serial numbers. Returns null if the
 * value is not a real date.
 */
export const parseImportDate = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : toIsoDate(
          value.getUTCFullYear(),
          value.getUTCMonth() + 1,
          value.getUTCDate(),
        );
  }

  if (typeof value === "number") {
    // Serial 60 is Excel's nonexistent 1900-02-29; real dates start at 1.
    if (!Number.isFinite(value) || value < 1 || value > 2_958_465) {
      return null;
    }

    const date = new Date(EXCEL_EPOCH_UTC + Math.floor(value) * MS_PER_DAY);

    return toIsoDate(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (/^\d{5}$/.test(text)) {
      return parseImportDate(Number(text));
    }

    return parseFlexibleDateToIso(text);
  }

  return null;
};

/** Parses a cell into `HH:MM` (24h). Accepts H:MM[:SS], Date and Excel fractions. */
export const parseImportTime = (value: unknown): string | null => {
  const pad = (n: number) => String(n).padStart(2, "0");

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      return null;
    }

    const minutes = Math.round(value * 1440);

    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }

  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);

    if (match && Number(match[1]) <= 23) {
      return `${pad(Number(match[1]))}:${match[2]}`;
    }
  }

  return null;
};

/** Case- and accent-insensitive key for matching catalog names. */
export const catalogKey = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const enumLookup = (options: readonly string[]) => {
  const lookup = new Map(options.map((option) => [catalogKey(option), option]));

  return (value: unknown) => lookup.get(catalogKey(value)) ?? null;
};

export const parsePersonStatus = (value: unknown) => {
  const match = enumLookup(PERSON_STATUS_OPTIONS)(value);

  return match === null ? null : (match.toLowerCase() as "activa" | "baja");
};

export const parseContractType = (value: unknown) => {
  const match = enumLookup(CONTRACT_TYPE_OPTIONS)(value);

  return match === null
    ? null
    : (match.toLowerCase() as "determinado" | "indeterminado");
};

export const parseNoticeWindow = (value: unknown) => {
  const match = enumLookup(NOTICE_OPTIONS)(value);

  return match === null
    ? null
    : match === "No avisar"
      ? ("no_avisar" as const)
      : (match as "1" | "2" | "3" | "6");
};

export const parseContractStatus = (value: unknown) => {
  const match = enumLookup(CONTRACT_STATUS_OPTIONS)(value);

  return match === null
    ? null
    : (match.toLowerCase().replace(" ", "_") as
        "vigente" | "renovado" | "no_renovado" | "vencido");
};
