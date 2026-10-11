import ExcelJS from "exceljs";

import {
  CATALOGS_SHEET_NAME,
  CONTRACT_STATUS_OPTIONS,
  CONTRACT_TYPE_OPTIONS,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  IMPORT_SHEETS,
  INSTRUCTIONS_SHEET_NAME,
  NOTICE_OPTIONS,
  PERSON_STATUS_OPTIONS,
  SHEET_NAMES,
  type ImportColumn,
} from "./format";

export type TemplateCatalogs = {
  areas: string[];
  positions: string[];
  sites: string[];
  templates: string[];
};

// exceljs supports range validations but does not type them.
type RangeValidations = {
  add: (range: string, rule: ExcelJS.DataValidation) => void;
};

type CatalogColumn = {
  header: string;
  values: readonly string[];
};

const HEADER_FILL = "FF0F766E";
const HEADER_FONT = "FFFFFFFF";

const catalogColumns = (catalogs: TemplateCatalogs): CatalogColumn[] => [
  { header: "Áreas", values: catalogs.areas },
  { header: "Puestos", values: catalogs.positions },
  { header: "Sucursales", values: catalogs.sites },
  { header: "Plantillas de contrato", values: catalogs.templates },
  { header: "Estatus de persona", values: PERSON_STATUS_OPTIONS },
  { header: "Tipo de contrato", values: CONTRACT_TYPE_OPTIONS },
  { header: "Aviso (meses)", values: NOTICE_OPTIONS },
  { header: "Estatus de contrato", values: CONTRACT_STATUS_OPTIONS },
];

const columnLetter = (index: number) => {
  let n = index + 1;
  let letters = "";

  while (n > 0) {
    const rem = (n - 1) % 26;

    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }

  return letters;
};

/** Which Catálogos column feeds the dropdown of an import column. */
const dropdownSource = (column: ImportColumn): string | null => {
  if (column.catalog === "areas") return "Áreas";
  if (column.catalog === "positions") return "Puestos";
  if (column.catalog === "sites") return "Sucursales";
  if (column.catalog === "templates") return "Plantillas de contrato";
  if (column.key === "estatus") {
    return column.options === PERSON_STATUS_OPTIONS
      ? "Estatus de persona"
      : "Estatus de contrato";
  }
  if (column.key === "tipo") return "Tipo de contrato";
  if (column.key === "aviso") return "Aviso (meses)";

  return null;
};

const instructionRows = (): string[][] => {
  const rows: string[][] = [
    ["Plantilla de importación de personas de Workia"],
    [""],
    ["Cómo usar este archivo"],
    [
      "1. Llena la hoja Personas (una fila por persona). Horarios y Contratos son opcionales.",
    ],
    [
      "2. Usa los nombres de Área, Puesto y Sucursal tal como aparecen en la hoja Catálogos; las celdas tienen listas desplegables.",
    ],
    [
      "3. No cambies los encabezados. Puedes dejar columnas vacías o borrar las que no uses, salvo las obligatorias.",
    ],
    [
      "4. Sube el archivo en Personas > Importar. Antes de aplicar verás una revisión de cada fila.",
    ],
    [
      `5. Límites: ${IMPORT_LIMITS.maxRows.toLocaleString("es-MX")} filas por archivo y ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB.`,
    ],
    [""],
    ["Cómo se identifica a una persona"],
    [
      "Primero por ID Workia; si no hay, por CURP; si tampoco, por RFC. Una fila sin ninguno siempre se crea como persona nueva (y se avisa si el nombre y la fecha de nacimiento coinciden con otra).",
    ],
    [
      "Los archivos exportados desde Workia traen el ID Workia y se pueden volver a importar sin duplicar.",
    ],
    [""],
    ["Formatos"],
    [
      "Fechas: AAAA-MM-DD, DD/MM/AAAA o fecha de Excel. Horas: HH:MM en 24 horas.",
    ],
    [
      "CURP, RFC y NSS se escriben sin espacios; se validan y no pueden repetirse entre personas activas.",
    ],
    [
      "Jefe directo: CURP o ID Workia de otra fila del archivo o de una persona que ya existe.",
    ],
    [""],
  ];

  for (const sheet of IMPORT_SHEETS) {
    rows.push([`Hoja ${SHEET_NAMES[sheet]}`]);

    for (const column of IMPORT_COLUMNS[sheet]) {
      rows.push([`${column.label}${column.required ? " *" : ""}`, column.help]);
    }

    rows.push([""]);
  }

  rows.push(["* Obligatoria."]);

  return rows;
};

export const buildImportTemplate = async (
  catalogs: TemplateCatalogs,
): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Workia";

  const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET_NAME);

  instructions.getColumn(1).width = 34;
  instructions.getColumn(2).width = 90;

  for (const row of instructionRows()) {
    const added = instructions.addRow(row);
    const isTitle = row.length === 1 && row[0] !== "" && !/^\d\./.test(row[0]);

    if (isTitle) {
      added.font = { bold: true };
    }
  }

  instructions.getRow(1).font = { bold: true, size: 14 };

  const sheets = Object.fromEntries(
    IMPORT_SHEETS.map((key) => {
      const sheet = workbook.addWorksheet(SHEET_NAMES[key]);
      const columns = IMPORT_COLUMNS[key];

      sheet.columns = columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: column.width,
      }));

      const header = sheet.getRow(1);

      header.font = { bold: true, color: { argb: HEADER_FONT } };
      header.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_FILL },
      };
      header.alignment = { vertical: "middle", wrapText: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      columns.forEach((column, index) => {
        if (column.kind === "date") {
          sheet.getColumn(index + 1).numFmt = "yyyy-mm-dd";
        }

        if (column.kind === "time") {
          sheet.getColumn(index + 1).numFmt = "hh:mm";
        }

        if (
          column.key === "curp" ||
          column.key === "rfc" ||
          column.key === "nss"
        ) {
          sheet.getColumn(index + 1).numFmt = "@";
        }
      });

      return [key, sheet] as const;
    }),
  );

  const catalogSheet = workbook.addWorksheet(CATALOGS_SHEET_NAME);
  const catalogs_ = catalogColumns(catalogs);
  const catalogRange = new Map<string, string>();

  catalogs_.forEach((catalog, index) => {
    const letter = columnLetter(index);
    const cell = catalogSheet.getCell(`${letter}1`);

    cell.value = catalog.header;
    cell.font = { bold: true };
    catalogSheet.getColumn(index + 1).width = 30;

    catalog.values.forEach((value, row) => {
      catalogSheet.getCell(`${letter}${row + 2}`).value = value;
    });

    // Always leave at least one cell so the validation range is well formed.
    const last = Math.max(catalog.values.length, 1) + 1;

    catalogRange.set(
      catalog.header,
      `'${CATALOGS_SHEET_NAME}'!$${letter}$2:$${letter}$${last}`,
    );
  });

  catalogSheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const key of IMPORT_SHEETS) {
    IMPORT_COLUMNS[key].forEach((column, index) => {
      const source = dropdownSource(column);
      const range = source ? catalogRange.get(source) : undefined;

      if (!range) {
        return;
      }

      const letter = columnLetter(index);

      // One validation per column range keeps the file small.
      const validations = (
        sheets[key] as unknown as { dataValidations: RangeValidations }
      ).dataValidations;

      validations.add(`${letter}2:${letter}${IMPORT_LIMITS.maxRows + 1}`, {
        type: "list",
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: column.label,
        error: "El valor no está en el catálogo.",
      });
    });
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
};
