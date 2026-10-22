import ExcelJS from "exceljs";

import {
  CATALOGS_SHEET_NAME,
  CONTRACT_STATUS_OPTIONS,
  CONTRACT_TYPE_OPTIONS,
  EXAMPLE_SHEET_NAME,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  IMPORT_SHEETS,
  INSTRUCTIONS_SHEET_NAME,
  NOTICE_OPTIONS,
  PERSON_STATUS_OPTIONS,
  RECONTRATABLE_OPTIONS,
  SHEET_NAMES,
  TERMINATION_TYPE_OPTIONS,
  type ImportColumn,
  type ImportSheetKey,
} from "./format";

export type TemplateCatalogs = {
  areas: string[];
  positions: string[];
  sites: string[];
  templates: string[];
  /**
   * Puestos offered for each area, so Puesto depends on the row's Área.
   * Positions without an area belong in every area's list.
   */
  areaPositions?: { area: string; positions: string[] }[];
  /** Full names of active people, suggested in Jefe directo. */
  managers?: string[];
  /** Active motivos de baja of the company, for Motivo de baja. */
  terminationReasons?: string[];
};

// exceljs supports range validations but does not type them.
type RangeValidations = {
  add: (range: string, rule: ExcelJS.DataValidation) => void;
};

type CatalogColumn = {
  header: string;
  values: readonly string[];
};

// Header colors: required columns stand out, ID Workia fades into the background.
const REQUIRED_FILL = "FF0B7FA6";
const REQUIRED_FONT = "FFFFFFFF";
const OPTIONAL_FILL = "FFD5ECF1";
const OPTIONAL_FONT = "FF0F2A33";
const TECHNICAL_FILL = "FFE5E7EB";
const TECHNICAL_FONT = "FF6B7280";

const MANAGERS_HEADER = "Personas activas (jefe directo)";
const AREA_OF_POSITION_HEADER = "Área (puestos por área)";
const POSITION_BY_AREA_HEADER = "Puesto (por área)";

const catalogColumns = (catalogs: TemplateCatalogs): CatalogColumn[] => [
  { header: "Áreas", values: catalogs.areas },
  { header: "Puestos", values: catalogs.positions },
  { header: "Sucursales", values: catalogs.sites },
  { header: "Plantillas de contrato", values: catalogs.templates },
  { header: "Estatus de persona", values: PERSON_STATUS_OPTIONS },
  { header: "Tipo de contrato", values: CONTRACT_TYPE_OPTIONS },
  { header: "Aviso (meses)", values: NOTICE_OPTIONS },
  { header: "Estatus de contrato", values: CONTRACT_STATUS_OPTIONS },
  { header: MANAGERS_HEADER, values: catalogs.managers ?? [] },
  { header: "Motivos de baja", values: catalogs.terminationReasons ?? [] },
  { header: "Tipo de baja", values: TERMINATION_TYPE_OPTIONS },
  { header: "Recontratable", values: RECONTRATABLE_OPTIONS },
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
  if (column.catalog === "terminationReasons") return "Motivos de baja";
  if (column.key === "estatus") {
    return column.options === PERSON_STATUS_OPTIONS
      ? "Estatus de persona"
      : "Estatus de contrato";
  }
  if (column.key === "tipo") return "Tipo de contrato";
  if (column.key === "aviso") return "Aviso (meses)";
  if (column.key === "jefeDirecto") return MANAGERS_HEADER;
  if (column.key === "tipoBaja") return "Tipo de baja";
  if (column.key === "recontratable") return "Recontratable";

  return null;
};

/** What Excel says when a value is not in a dropdown, and how to fix it. */
const dropdownError = (column: ImportColumn) => {
  if (column.key === "puesto") {
    return "Elige un puesto de la lista: muestra los puestos del Área de la fila. Si el puesto es de otra área, cambia primero el Área.";
  }

  if (column.catalog === "terminationReasons") {
    return "Elige un motivo de la lista. Si falta, agrégalo en Catálogo > Motivos de baja y descarga otra plantilla.";
  }

  if (column.catalog && column.catalog !== "templates") {
    return "Elige un valor de la lista. Si falta, agrégalo en el Catálogo de Workia y descarga otra plantilla.";
  }

  return "Elige un valor de la lista.";
};

/** Dates Excel accepts in date columns: 1900 through a year from today. */
const dateBounds = (today: Date) => ({
  // exceljs ignores Excel's phantom 1900-02-29, so serial 1 (1900-01-01) is
  // written from the day before.
  min: new Date(Date.UTC(1899, 11, 31)),
  max: new Date(
    Date.UTC(
      today.getUTCFullYear() + 1,
      today.getUTCMonth(),
      today.getUTCDate(),
    ),
  ),
});

type InstructionRow = { cells: string[]; title?: boolean };

const instructionRows = (maxDate: string): InstructionRow[] => {
  const limit = (sheet: ImportSheetKey) =>
    IMPORT_LIMITS.maxRowsPerSheet[sheet].toLocaleString("es-MX");
  const text = (...cells: string[]): InstructionRow => ({ cells });
  const title = (cell: string): InstructionRow => ({
    cells: [cell],
    title: true,
  });
  const rows: InstructionRow[] = [
    title("Plantilla de importación de personas de Workia"),
    text(""),
    title("Cómo usar este archivo"),
    text(
      `1. Mira la hoja ${EXAMPLE_SHEET_NAME}: trae personas ficticias ya capturadas y nunca se importa.`,
    ),
    text(
      "2. Llena la hoja Personas (una fila por persona). Horarios y Contratos son opcionales.",
    ),
    text(
      "3. Usa los nombres de Área, Puesto y Sucursal tal como aparecen en la hoja Catálogos; las celdas tienen listas desplegables.",
    ),
    text(
      "4. No cambies los encabezados. Puedes dejar columnas vacías o borrar las que no uses, salvo las obligatorias.",
    ),
    text(
      "5. Sube el archivo en Personas > Importar. Antes de aplicar verás una revisión de cada fila.",
    ),
    text(
      `6. Límites: ${limit("personas")} personas por archivo (Horarios: ${limit("horarios")} filas; Contratos: ${limit("contratos")} filas) y ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB.`,
    ),
    text(""),
    title("Colores de los encabezados"),
    text("Azul oscuro", "Obligatoria: la fila no se importa si está vacía."),
    text("Azul claro", "Opcional."),
    text(
      "Gris",
      "ID Workia: déjalo vacío en altas nuevas. Viene lleno en una exportación de Workia.",
    ),
    text(
      "Comentarios",
      "Cada encabezado tiene un comentario con lo que acepta la columna.",
    ),
    text(""),
    title("Cómo se identifica a una persona"),
    text(
      "Primero por ID Workia; si no hay, por CURP; si tampoco, por RFC. Una fila sin ninguno siempre se crea como persona nueva (y se avisa si el nombre y la fecha de nacimiento coinciden con otra).",
    ),
    text(
      "Los archivos exportados desde Workia traen el ID Workia y se pueden volver a importar sin duplicar.",
    ),
    text(""),
    title("Formatos"),
    text(
      `Fechas: escribe AAAA-MM-DD (por ejemplo 2026-04-03) o DD/MM/AAAA con el día primero: 03/04/2026 es 3 de abril. Las celdas aceptan fechas de 1900 a ${maxDate}.`,
    ),
    text(
      "Ojo: un Excel en inglés convierte 03/04/2026 escrito a mano en 4 de marzo antes de que Workia lo vea. Si tu Excel está en inglés, escribe las fechas como AAAA-MM-DD.",
    ),
    text("Horas: HH:MM en 24 horas, por ejemplo 08:30 o 17:00."),
    text(
      "CURP, RFC, NSS y Teléfono son columnas de texto: conservan los ceros al inicio. Si pegas desde otra hoja, usa Pegado especial > Valores para no traer el formato de número.",
    ),
    text(
      "CURP, RFC y NSS se escriben sin espacios; se validan y no pueden repetirse entre personas activas.",
    ),
    text(
      "Jefe directo: nombre completo (como está en Workia o en este archivo), CURP o ID Workia. La lista sugiere personas activas; si dos personas se llaman igual, usa la CURP o el ID Workia.",
    ),
    text(
      "Puesto: la lista muestra los puestos del Área elegida en la fila. En Google Sheets o LibreOffice puede mostrar todos; Workia lo revisa al importar.",
    ),
    text(
      "Las listas solo aceptan sus valores. Si falta un área, puesto o sucursal, agrégalo en el Catálogo de Workia y descarga otra plantilla, o al importar marca «Crear áreas, puestos y sucursales que no existan».",
    ),
    text(""),
    title("Bajas y antigüedad"),
    text(
      "Para dar de baja: Estatus Baja, Fecha de baja, Tipo de baja, Motivo de baja y Recontratable (el Comentario es opcional). Se cierra el periodo laboral vigente y el contrato vigente queda «Terminado», igual que al dar de baja en Workia.",
    ),
    text(
      "Si escribes solo Estatus Baja, la baja queda «sin fecha» y marcada para revisión en el expediente; la revisión de la importación te lo avisa en la fila.",
    ),
    text(
      "Para corregir una baja ya registrada, cambia esas columnas en la fila de la persona. Una celda vacía no borra lo guardado.",
    ),
    text(
      "Motivo de baja: un motivo activo de Catálogo > Motivos de baja. Si falta, agrégalo ahí y descarga otra plantilla.",
    ),
    text(
      "Fecha de antigüedad: solo para personas activas cuya antigüedad cuenta desde antes del ingreso (por ejemplo, un reingreso que reconoce la antigüedad previa). Vacía o igual a la Fecha de ingreso no cambia nada.",
    ),
    text(
      "El finiquito no se importa: captúralo en el expediente de la persona.",
    ),
    text(""),
  ];

  for (const sheet of IMPORT_SHEETS) {
    rows.push(title(`Hoja ${SHEET_NAMES[sheet]}`));

    for (const column of IMPORT_COLUMNS[sheet]) {
      rows.push(
        text(`${column.label}${column.required ? " *" : ""}`, column.help),
      );
    }

    rows.push(text(""));
  }

  rows.push(text("* Obligatoria."));

  return rows;
};

/** Required, optional and technical (ID Workia) headers look different. */
const styleHeader = (
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  key: ImportSheetKey,
) => {
  const header = sheet.getRow(rowNumber);

  header.alignment = { vertical: "middle", wrapText: true };

  IMPORT_COLUMNS[key].forEach((column, index) => {
    const cell = header.getCell(index + 1);
    const technical = column.key === "idWorkia";
    const [fill, color] = column.required
      ? [REQUIRED_FILL, REQUIRED_FONT]
      : technical
        ? [TECHNICAL_FILL, TECHNICAL_FONT]
        : [OPTIONAL_FILL, OPTIONAL_FONT];

    cell.font = { bold: true, color: { argb: color } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.note = column.required
      ? `Obligatoria. ${column.help}`
      : technical
        ? "Déjalo vacío en altas nuevas. Viene lleno en una exportación de Workia."
        : column.help;
  });
};

/** Fictional people that show a filled-in Personas sheet. Never imported. */
const exampleRows = (catalogs: TemplateCatalogs) => {
  const area = catalogs.areas[0] ?? "Ventas";
  const position =
    catalogs.areaPositions?.find((entry) => entry.area === area)
      ?.positions[0] ??
    catalogs.positions[0] ??
    "Vendedor";
  const site = catalogs.sites[0] ?? "Matriz";
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const rows: Record<string, string | Date>[] = [
    {
      nombres: "Laura",
      apellidoPaterno: "Méndez",
      apellidoMaterno: "Ortiz",
      email: "laura.mendez@ejemplo.mx",
      telefono: "5512345678",
      fechaNacimiento: date("1988-05-14"),
      fechaIngreso: date("2020-02-03"),
      area,
      puesto: position,
      sucursal: site,
      rfc: "XEXX880514AB1",
      curp: "XEXX880514MDFXXX04",
      nss: "04123456784",
      estatus: "Activa",
    },
    {
      nombres: "Ricardo",
      apellidoPaterno: "Salas",
      apellidoMaterno: "Vega",
      email: "ricardo.salas@ejemplo.mx",
      telefono: "3398765432",
      fechaNacimiento: date("1991-03-02"),
      fechaIngreso: date("2024-04-03"),
      area,
      puesto: position,
      sucursal: site,
      jefeDirecto: "Laura Méndez Ortiz",
      rfc: "XEXX910302CD2",
      curp: "XEXX910302HJCXXX07",
      nss: "03987654328",
    },
    {
      nombres: "Ana",
      apellidoPaterno: "Torres",
      fechaIngreso: date("2026-01-12"),
      area,
      sucursal: site,
      jefeDirecto: "XEXX880514MDFXXX04",
      curp: "XEXX950817MNLXXX03",
      nss: "07234567894",
    },
    {
      nombres: "Jorge",
      apellidoPaterno: "Ibarra",
      apellidoMaterno: "Luna",
      fechaIngreso: date("2019-08-05"),
      area,
      puesto: position,
      sucursal: site,
      curp: "XEXX870921HQTXXX08",
      estatus: "Baja",
      fechaBaja: date("2025-11-28"),
      tipoBaja: TERMINATION_TYPE_OPTIONS[0],
      motivoBaja: catalogs.terminationReasons?.[0] ?? "Renuncia voluntaria",
      comentarioBaja: "Se cambió de ciudad.",
      recontratable: "Sí",
    },
  ];

  return rows;
};

const addExampleSheet = (
  workbook: ExcelJS.Workbook,
  catalogs: TemplateCatalogs,
) => {
  const sheet = workbook.addWorksheet(EXAMPLE_SHEET_NAME, {
    properties: { tabColor: { argb: TECHNICAL_FONT } },
  });
  const columns = IMPORT_COLUMNS.personas;

  columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);

    sheetColumn.width = column.width;

    if (column.kind === "date") {
      sheetColumn.numFmt = "yyyy-mm-dd";
    }
  });

  sheet.mergeCells(1, 1, 1, columns.length);

  const banner = sheet.getCell(1, 1);

  banner.value =
    "EJEMPLO: esta hoja no se importa. Las personas son ficticias; captura las tuyas en la hoja Personas, que tiene las mismas columnas.";
  banner.font = { bold: true, color: { argb: OPTIONAL_FONT } };
  banner.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: TECHNICAL_FILL },
  };

  sheet.getRow(2).values = columns.map((column) => column.label);
  styleHeader(sheet, 2, "personas");

  for (const example of exampleRows(catalogs)) {
    sheet.addRow(columns.map((column) => example[column.key] ?? null));
  }

  sheet.views = [{ state: "frozen", ySplit: 2 }];
};

export const buildImportTemplate = async (
  catalogs: TemplateCatalogs,
  today: Date = new Date(),
): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  const bounds = dateBounds(today);
  const maxDate = bounds.max.toISOString().slice(0, 10);

  workbook.creator = "Workia";

  const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET_NAME);

  instructions.getColumn(1).width = 34;
  instructions.getColumn(2).width = 90;

  for (const row of instructionRows(maxDate)) {
    const added = instructions.addRow(row.cells);

    if (row.title) {
      added.font = { bold: true };
    }
  }

  instructions.getRow(1).font = { bold: true, size: 14 };

  addExampleSheet(workbook, catalogs);

  const sheets = Object.fromEntries(
    IMPORT_SHEETS.map((key) => {
      const sheet = workbook.addWorksheet(SHEET_NAMES[key]);
      const columns = IMPORT_COLUMNS[key];

      sheet.columns = columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: column.width,
      }));
      styleHeader(sheet, 1, key);
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      columns.forEach((column, index) => {
        const sheetColumn = sheet.getColumn(index + 1);

        if (column.kind === "date") {
          sheetColumn.numFmt = "yyyy-mm-dd";
        }

        if (column.kind === "time") {
          sheetColumn.numFmt = "hh:mm";
        }

        // Text, so Excel keeps leading zeros (NSS, phone numbers).
        if (["curp", "rfc", "nss", "telefono"].includes(column.key)) {
          sheetColumn.numFmt = "@";
        }
      });

      return [key, sheet] as const;
    }),
  ) as Record<ImportSheetKey, ExcelJS.Worksheet>;

  const catalogSheet = workbook.addWorksheet(CATALOGS_SHEET_NAME);
  const catalogs_ = catalogColumns(catalogs);
  const catalogRange = new Map<string, string>();
  const absolute = (letter: string, first: number, last: number) =>
    `'${CATALOGS_SHEET_NAME}'!$${letter}$${first}:$${letter}$${last}`;
  const header = (index: number, value: string) => {
    const cell = catalogSheet.getCell(`${columnLetter(index)}1`);

    cell.value = value;
    cell.font = { bold: true };
    catalogSheet.getColumn(index + 1).width = 30;
  };

  catalogs_.forEach((catalog, index) => {
    const letter = columnLetter(index);

    header(index, catalog.header);

    catalog.values.forEach((value, row) => {
      catalogSheet.getCell(`${letter}${row + 2}`).value = value;
    });

    // Always leave at least one cell so the validation range is well formed.
    const last = Math.max(catalog.values.length, 1) + 1;

    catalogRange.set(catalog.header, absolute(letter, 2, last));
  });

  // Puestos by area, one block per area, each behind a defined name that the
  // Puesto dropdown picks with INDIRECT from the row's Área.
  const areaLetter = columnLetter(catalogs_.length);
  const byAreaLetter = columnLetter(catalogs_.length + 1);
  let nextRow = 2;

  header(catalogs_.length, AREA_OF_POSITION_HEADER);
  header(catalogs_.length + 1, POSITION_BY_AREA_HEADER);

  catalogs.areas.forEach((area, index) => {
    const positions =
      catalogs.areaPositions?.find((entry) => entry.area === area)?.positions ??
      catalogs.positions;
    const first = nextRow;

    for (const position of positions.length > 0 ? positions : [""]) {
      catalogSheet.getCell(`${areaLetter}${nextRow}`).value = area;
      catalogSheet.getCell(`${byAreaLetter}${nextRow}`).value = position;
      nextRow += 1;
    }

    workbook.definedNames.add(
      absolute(byAreaLetter, first, nextRow - 1),
      `PuestosArea_${index + 1}`,
    );
  });

  workbook.definedNames.add(catalogRange.get("Áreas")!, "Areas");
  workbook.definedNames.add(catalogRange.get("Puestos")!, "Puestos");
  catalogSheet.views = [{ state: "frozen", ySplit: 1 }];

  const areaColumn = columnLetter(
    IMPORT_COLUMNS.personas.findIndex((column) => column.key === "area"),
  );

  for (const key of IMPORT_SHEETS) {
    // One validation per column range keeps the file small.
    const validations = (
      sheets[key] as unknown as { dataValidations: RangeValidations }
    ).dataValidations;
    const lastRow = IMPORT_LIMITS.maxRowsPerSheet[key] + 1;

    IMPORT_COLUMNS[key].forEach((column, index) => {
      const letter = columnLetter(index);
      const range = `${letter}2:${letter}${lastRow}`;

      if (column.kind === "date") {
        validations.add(range, {
          type: "date",
          operator: "between",
          allowBlank: true,
          formulae: [bounds.min, bounds.max],
          showErrorMessage: true,
          errorStyle: "stop",
          errorTitle: column.label,
          error: `Escribe una fecha entre 1900 y ${maxDate}, como 2026-04-03 (AAAA-MM-DD) o 03/04/2026 (día primero).`,
        });

        return;
      }

      const source = dropdownSource(column);
      const list = source ? catalogRange.get(source) : undefined;

      if (!list) {
        return;
      }

      // Jefe directo also takes a CURP, an ID Workia or someone else in this
      // file, so its list only suggests names.
      if (column.key === "jefeDirecto") {
        if ((catalogs.managers ?? []).length > 0) {
          validations.add(range, {
            type: "list",
            allowBlank: true,
            formulae: [list],
            showErrorMessage: false,
          });
        }

        return;
      }

      // Puesto lists the row's area; with no (known) area, every puesto.
      const formula =
        column.key === "puesto" && catalogs.areas.length > 0
          ? `IF(ISNA(MATCH($${areaColumn}2,Areas,0)),Puestos,INDIRECT("PuestosArea_"&MATCH($${areaColumn}2,Areas,0)))`
          : list;

      validations.add(range, {
        type: "list",
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: column.label,
        error: dropdownError(column),
      });
    });
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
};
