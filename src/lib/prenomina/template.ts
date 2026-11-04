import { z } from "zod";

/**
 * Pre-nómina templates (Workia 2.0 W2-18): how one payroll provider wants
 * the file. The provider is not chosen yet, so a template only describes a
 * shape: CSV or Excel, one row per person ("wide") or one row per person and
 * concept ("long", the usual "movimientos" import), which columns in which
 * order, the provider's concept codes, and the CSV details. Pure: no
 * database access, so the screens and the tests share it.
 */

export const PRENOMINA_FORMATS = ["csv", "xlsx"] as const;
export const PRENOMINA_LAYOUTS = ["wide", "long"] as const;
export const PRENOMINA_DELIMITERS = [",", ";", "|", "\t"] as const;
export const PRENOMINA_ENCODINGS = ["utf8_bom", "utf8", "latin1"] as const;
export const PRENOMINA_DATE_FORMATS = [
  "iso",
  "dmy",
  "dmy_dash",
  "ymd_compact",
] as const;

export type PrenominaFormat = (typeof PRENOMINA_FORMATS)[number];
export type PrenominaLayout = (typeof PRENOMINA_LAYOUTS)[number];
export type PrenominaDelimiter = (typeof PRENOMINA_DELIMITERS)[number];
export type PrenominaEncoding = (typeof PRENOMINA_ENCODINGS)[number];
export type PrenominaDateFormat = (typeof PRENOMINA_DATE_FORMATS)[number];

/**
 * What pre-nómina counts per person, from the close snapshot. Days, except
 * the two minute totals. Only what is not justified counts as falta, retardo
 * or salida anticipada; a justified falta counts under what justified it.
 */
export const PRENOMINA_CONCEPTS = [
  "faltas",
  "retardos",
  "minutos_retardo",
  "salidas_anticipadas",
  "minutos_salida",
  "permisos_con_goce",
  "permisos_sin_goce",
  "incapacidades",
  "vacaciones",
  "faltas_justificadas_rh",
] as const;

export type PrenominaConcept = (typeof PRENOMINA_CONCEPTS)[number];
export type PrenominaTotals = Record<PrenominaConcept, number>;

export const PRENOMINA_CONCEPT_LABELS: Record<PrenominaConcept, string> = {
  faltas: "Faltas",
  retardos: "Retardos",
  minutos_retardo: "Minutos de retardo",
  salidas_anticipadas: "Salidas anticipadas",
  minutos_salida: "Minutos de salida anticipada",
  permisos_con_goce: "Permisos con goce",
  permisos_sin_goce: "Permisos sin goce",
  incapacidades: "Incapacidades IMSS",
  vacaciones: "Vacaciones",
  faltas_justificadas_rh: "Faltas justificadas por RH",
};

export const emptyTotals = (): PrenominaTotals =>
  Object.fromEntries(
    PRENOMINA_CONCEPTS.map((concept) => [concept, 0]),
  ) as PrenominaTotals;

export const PERSON_FIELDS = [
  "workia_id",
  "curp",
  "rfc",
  "nss",
  "nombre_completo",
  "apellido_paterno",
  "apellido_materno",
  "nombres",
  "checador",
  "sucursal",
] as const;

export const PERIOD_FIELDS = [
  "periodo",
  "numero_periodo",
  "fecha_inicio",
  "fecha_fin",
] as const;

/** Only in a "long" template: the concept's code, name and amount. */
export const LONG_FIELDS = ["concepto", "concepto_nombre", "cantidad"] as const;

export type PersonField = (typeof PERSON_FIELDS)[number];
export type PeriodField = (typeof PERIOD_FIELDS)[number];
export type LongField = (typeof LONG_FIELDS)[number];
export type PrenominaField =
  PersonField | PeriodField | LongField | PrenominaConcept | "constante";

export const PRENOMINA_FIELDS = [
  ...PERSON_FIELDS,
  ...PERIOD_FIELDS,
  ...PRENOMINA_CONCEPTS,
  ...LONG_FIELDS,
  "constante",
] as const satisfies readonly PrenominaField[];

export const PRENOMINA_FIELD_LABELS: Record<PrenominaField, string> = {
  workia_id: "Id de Workia",
  curp: "CURP",
  rfc: "RFC",
  nss: "NSS",
  nombre_completo: "Nombre completo",
  apellido_paterno: "Apellido paterno",
  apellido_materno: "Apellido materno",
  nombres: "Nombres",
  checador: "Número de checador",
  sucursal: "Sucursal",
  periodo: "Quincena (2026-11-Q1)",
  numero_periodo: "Número de quincena del año (1 a 24)",
  fecha_inicio: "Fecha de inicio",
  fecha_fin: "Fecha de fin",
  ...PRENOMINA_CONCEPT_LABELS,
  concepto: "Clave del concepto",
  concepto_nombre: "Nombre del concepto",
  cantidad: "Cantidad",
  constante: "Texto fijo",
};

/** Identifiers a provider matches people by: a person without one is flagged. */
export const IDENTIFIER_FIELDS: readonly PersonField[] = [
  "workia_id",
  "curp",
  "rfc",
  "nss",
  "checador",
];

export const isConcept = (field: string): field is PrenominaConcept =>
  (PRENOMINA_CONCEPTS as readonly string[]).includes(field);

export const MAX_TEMPLATE_COLUMNS = 60;
export const MAX_HEADER = 60;
export const MAX_CONSTANT = 60;
export const MAX_CONCEPT_CODE = 20;
export const MAX_TEMPLATE_NAME = 80;

// Printable text only: a header or code goes into a file another system reads.
const printable = /^[^\p{Cc}]*$/u;

const columnSchema = z.object({
  header: z
    .string()
    .trim()
    .max(MAX_HEADER, `Un encabezado tiene máximo ${MAX_HEADER} caracteres.`)
    .regex(printable, "Un encabezado no puede llevar tabuladores ni saltos."),
  field: z.enum(PRENOMINA_FIELDS, { error: "Campo desconocido." }),
  value: z
    .string()
    .trim()
    .max(MAX_CONSTANT, `Un texto fijo tiene máximo ${MAX_CONSTANT} caracteres.`)
    .regex(printable, "Un texto fijo no puede llevar tabuladores ni saltos.")
    .optional(),
});

export type PrenominaColumn = z.infer<typeof columnSchema>;

export const prenominaTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Escribe un nombre.")
      .max(MAX_TEMPLATE_NAME, `Máximo ${MAX_TEMPLATE_NAME} caracteres.`),
    format: z.enum(PRENOMINA_FORMATS),
    layout: z.enum(PRENOMINA_LAYOUTS),
    delimiter: z.enum(PRENOMINA_DELIMITERS).default(","),
    encoding: z.enum(PRENOMINA_ENCODINGS).default("utf8_bom"),
    dateFormat: z.enum(PRENOMINA_DATE_FORMATS).default("iso"),
    includeHeader: z.boolean().default(true),
    skipEmpty: z.boolean().default(true),
    columns: z
      .array(columnSchema)
      .min(1, "Agrega al menos una columna.")
      .max(MAX_TEMPLATE_COLUMNS, `Máximo ${MAX_TEMPLATE_COLUMNS} columnas.`),
    conceptCodes: z
      .partialRecord(
        z.enum(PRENOMINA_CONCEPTS),
        z
          .string()
          .trim()
          .max(
            MAX_CONCEPT_CODE,
            `Una clave tiene máximo ${MAX_CONCEPT_CODE} caracteres.`,
          )
          .regex(printable, "Una clave no puede llevar tabuladores ni saltos."),
      )
      .default({}),
  })
  .superRefine((template, ctx) => {
    const fields = template.columns.map((column) => column.field);
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message, path: ["columns"] });

    if (template.layout === "long") {
      if (!fields.includes("concepto") && !fields.includes("concepto_nombre")) {
        issue("Una plantilla por concepto necesita la columna del concepto.");
      }

      if (!fields.includes("cantidad")) {
        issue("Una plantilla por concepto necesita la columna de cantidad.");
      }

      if (fields.some(isConcept)) {
        issue(
          "En una plantilla por concepto, los conceptos van en «Claves de concepto», no como columnas.",
        );
      }

      if (
        !PRENOMINA_CONCEPTS.some((concept) => template.conceptCodes[concept])
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Escribe la clave de al menos un concepto.",
          path: ["conceptCodes"],
        });
      }
    } else {
      if (
        fields.some((field) =>
          (LONG_FIELDS as readonly string[]).includes(field),
        )
      ) {
        issue(
          "Concepto y cantidad sólo van en una plantilla de una fila por concepto.",
        );
      }

      if (!fields.some(isConcept)) {
        issue("Agrega al menos una columna de incidencias.");
      }
    }

    if (template.format === "xlsx" && template.encoding === "latin1") {
      ctx.addIssue({
        code: "custom",
        message: "La codificación sólo aplica a CSV.",
        path: ["encoding"],
      });
    }
  });

export type PrenominaTemplateInput = z.input<typeof prenominaTemplateSchema>;
export type PrenominaTemplateConfig = z.output<typeof prenominaTemplateSchema>;

/**
 * The template every company has before it makes its own: Excel, one row per
 * person, CURP and name, then every concept. A provider that takes a file
 * like this needs no template at all.
 */
export const DEFAULT_TEMPLATE: PrenominaTemplateConfig = {
  name: "Workia (genérica)",
  format: "xlsx",
  layout: "wide",
  delimiter: ",",
  encoding: "utf8_bom",
  dateFormat: "iso",
  includeHeader: true,
  skipEmpty: true,
  columns: [
    { header: "CURP", field: "curp" },
    { header: "RFC", field: "rfc" },
    { header: "NSS", field: "nss" },
    { header: "Nombre", field: "nombre_completo" },
    { header: "Sucursal", field: "sucursal" },
    { header: "Quincena", field: "periodo" },
    ...PRENOMINA_CONCEPTS.map((concept) => ({
      header: PRENOMINA_CONCEPT_LABELS[concept],
      field: concept,
    })),
  ],
  conceptCodes: {},
};

export const DEFAULT_TEMPLATE_ID = "workia";
