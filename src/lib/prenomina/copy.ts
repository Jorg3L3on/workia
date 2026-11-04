/** Words of the pre-nómina screens (W2-18). No database access here. */

import type {
  PrenominaDateFormat,
  PrenominaDelimiter,
  PrenominaEncoding,
  PrenominaFormat,
  PrenominaLayout,
} from "./template";

export const PRENOMINA_COPY = {
  title: "Pre-nómina",
  closedDescription:
    "Lo congelado en el cierre, listo para el proveedor de nómina. Para cambiarlo, reabre la quincena con un motivo y ciérrala de nuevo.",
  openDescription:
    "Cierra la quincena para exportar la pre-nómina. Cerrar es la aprobación: lo que se exporta no cambia sin una reapertura.",
  people: (count: number) =>
    count === 1
      ? "1 persona con incidencias"
      : `${count} personas con incidencias`,
  templateLabel: "Plantilla",
  download: "Descargar",
  noSalary: "Workia no calcula sueldos: el archivo sólo lleva días y minutos.",
  missing: (label: string, people: number) =>
    people === 1
      ? `1 persona del archivo no tiene ${label}.`
      : `${people} personas del archivo no tienen ${label}.`,
  templatesTitle: "Plantillas de pre-nómina",
  templatesDescription:
    "Cómo quiere el archivo cada proveedor de nómina: CSV o Excel, columnas, claves de concepto. La plantilla Workia sirve mientras no haya una propia.",
  newTemplate: "Nueva plantilla",
  edit: "Editar",
  archive: "Archivar",
  archiveConfirm: "¿Archivar la plantilla? Ya no se podrá elegir al exportar.",
  archived: "Plantilla archivada.",
  saved: "Plantilla guardada.",
  builtIn: "Incluida",
  save: "Guardar plantilla",
  denied: "Tu rol no permite cambiar plantillas de pre-nómina.",
  notFound: "Esa plantilla no existe.",
  invalid: "Revisa la plantilla.",
  columns: "Columnas",
  columnsHint:
    "En el orden del archivo. El encabezado es el texto de la primera fila; vacío, usa el nombre del campo.",
  addColumn: "Agregar columna",
  conceptCodes: "Claves de concepto",
  conceptCodesHint:
    "La clave que el proveedor usa para cada concepto. Sólo se exportan los conceptos con clave.",
  header: "Encabezado",
  field: "Campo",
  value: "Texto",
  includeHeader: "Primera fila con encabezados",
  skipEmpty: "Omitir a quien no tenga nada que reportar",
} as const;

export const FORMAT_LABELS: Record<PrenominaFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV",
};

export const LAYOUT_LABELS: Record<PrenominaLayout, string> = {
  wide: "Una fila por persona",
  long: "Una fila por persona y concepto",
};

export const DELIMITER_LABELS: Record<PrenominaDelimiter, string> = {
  ",": "Coma (,)",
  ";": "Punto y coma (;)",
  "|": "Barra (|)",
  "\t": "Tabulador",
};

export const ENCODING_LABELS: Record<PrenominaEncoding, string> = {
  utf8_bom: "UTF-8 con BOM (Excel)",
  utf8: "UTF-8",
  latin1: "Latin-1 (ISO-8859-1)",
};

export const DATE_FORMAT_LABELS: Record<PrenominaDateFormat, string> = {
  iso: "2026-11-01",
  dmy: "01/11/2026",
  dmy_dash: "01-11-2026",
  ymd_compact: "20261101",
};
