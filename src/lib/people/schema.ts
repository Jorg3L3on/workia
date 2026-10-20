import { z } from "zod";

import {
  blocksFromLegacy,
  formatScheduleBlocks,
  legacyFromBlocks,
  readStoredBlocks,
  scheduleBlocksSchema,
  type ScheduleBlocks,
  type WeekDay,
} from "./schedule-blocks";

import { formatDateMx } from "@/lib/format/date";

import {
  isValidCurp,
  isValidNss,
  isValidRfc,
  normalizeIdentifier,
  normalizeNss,
} from "./identity";

export const PERSON_STATUSES = ["activa", "baja"] as const;

export type PersonStatusValue = (typeof PERSON_STATUSES)[number];

export const personStatusLabels: Record<PersonStatusValue, string> = {
  activa: "Activa",
  baja: "Baja",
};

export const PERSON_LIST_VISIBILITY = ["expediente", "deleted"] as const;

export type PersonListVisibility = (typeof PERSON_LIST_VISIBILITY)[number];

export const personDeletedLabel = "Borrado";

export const personIsDeleted = (person: { deletedAt?: Date | string | null }) =>
  Boolean(person.deletedAt);

export const matchesPersonaListRow = (
  row: { status: PersonStatusValue; deleted: boolean },
  filters: {
    status?: PersonStatusValue | "";
    visibility?: PersonListVisibility;
  } = {},
) => {
  const visibility = filters.visibility ?? "expediente";

  if (visibility === "deleted" ? !row.deleted : row.deleted) {
    return false;
  }

  if (filters.status && row.status !== filters.status) {
    return false;
  }

  return true;
};

const optionalText = z.string().trim().max(120).optional().or(z.literal(""));

const optionalIdentifier = (
  normalize: (value: string) => string,
  isValid: (value: string) => boolean,
  message: string,
) =>
  z
    .string()
    .trim()
    .max(32)
    .transform(normalize)
    .refine((value) => value === "" || isValid(value), message)
    .optional();

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .optional()
  .or(z.literal(""));

const optionalUuid = z
  .string()
  .uuid("Selección inválida")
  .optional()
  .or(z.literal(""));

const optionalTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Hora inválida")
  .optional()
  .or(z.literal(""));

export const SCHEDULE_FIELD_LABELS = {
  horarioEntrada: "Entrada",
  horarioSalidaComer: "Salida a comer",
  horarioRegresoComer: "Regreso de comer",
  horarioSalida: "Salida",
} as const;

/** Las 32 entidades federativas, para domicilio y lugar de nacimiento. */
export const MX_STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
] as const;

export const MARITAL_STATUSES = [
  "soltero",
  "casado",
  "union_libre",
  "divorciado",
  "viudo",
] as const;

export const maritalStatusLabels: Record<
  (typeof MARITAL_STATUSES)[number],
  string
> = {
  soltero: "Soltero(a)",
  casado: "Casado(a)",
  union_libre: "Unión libre",
  divorciado: "Divorciado(a)",
  viudo: "Viudo(a)",
};

export const SEXES = ["H", "M"] as const;

export const sexLabels: Record<(typeof SEXES)[number], string> = {
  H: "Hombre",
  M: "Mujer",
};

/** Clave de elector del INE: 18 caracteres alfanuméricos. */
export const isValidIneClave = (value: string) => /^[A-Z0-9]{18}$/.test(value);

export const beneficiarySchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre del beneficiario es obligatorio")
    .max(160),
  parentesco: z.string().trim().min(1, "El parentesco es obligatorio").max(60),
  porcentaje: z.coerce
    .number()
    .gt(0, "El porcentaje debe ser mayor a 0")
    .max(100, "El porcentaje no puede pasar de 100"),
});

export type BeneficiaryValues = z.infer<typeof beneficiarySchema>;

/** Optional text that, when absent (undefined), leaves the stored value as is. */
const keepText = (max = 120) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const personMexicoFields = {
  domicilioCalle: keepText(160),
  domicilioNumeroExterior: keepText(20),
  domicilioNumeroInterior: keepText(20),
  domicilioColonia: keepText(120),
  domicilioMunicipio: keepText(120),
  domicilioEstado: z.enum(MX_STATES).optional().or(z.literal("")),
  domicilioCodigoPostal: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, "El código postal tiene 5 dígitos")
    .optional(),
  estadoCivil: z.enum(MARITAL_STATUSES).optional().or(z.literal("")),
  sexo: z.enum(SEXES).optional().or(z.literal("")),
  lugarNacimiento: z.enum(MX_STATES).optional().or(z.literal("")),
  nacionalidad: keepText(60),
  ineClaveElector: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase().replace(/\s+/g, ""))
    .refine(
      (value) => value === "" || isValidIneClave(value),
      "La clave de elector tiene 18 letras y números",
    )
    .optional(),
  /** Absent: keep the current beneficiaries. A list (even empty) replaces them. */
  beneficiarios: z
    .array(beneficiarySchema)
    .max(10, "Máximo 10 beneficiarios")
    .optional()
    .refine(
      (list) =>
        !list ||
        list.length === 0 ||
        Math.abs(list.reduce((sum, item) => sum + item.porcentaje, 0) - 100) <
          0.01,
      "Los porcentajes de los beneficiarios deben sumar 100",
    ),
};

export const personFormSchema = z.object({
  nombres: z
    .string()
    .trim()
    .min(1, "Los nombres son obligatorios")
    .max(120, "Máximo 120 caracteres"),
  apellidoPaterno: z
    .string()
    .trim()
    .min(1, "El apellido paterno es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  apellidoMaterno: optionalText,
  email: z
    .string()
    .trim()
    .email("Correo electrónico inválido")
    .max(254)
    .optional()
    .or(z.literal("")),
  telefono: optionalText,
  fechaNacimiento: optionalDate,
  fechaIngreso: optionalDate,
  areaId: optionalUuid,
  positionId: optionalUuid,
  managerId: optionalUuid,
  siteId: optionalUuid,
  rfc: optionalIdentifier(normalizeIdentifier, isValidRfc, "RFC inválido"),
  curp: optionalIdentifier(normalizeIdentifier, isValidCurp, "CURP inválida"),
  nss: optionalIdentifier(normalizeNss, isValidNss, "NSS inválido"),
  horarioEntrada: optionalTime,
  horarioSalidaComer: optionalTime,
  horarioRegresoComer: optionalTime,
  horarioSalida: optionalTime,
  /** Schedule by blocks (WRK-I5-3); undefined keeps the simple fields above as the source. */
  horarioBloques: scheduleBlocksSchema.optional(),
  status: z.enum(PERSON_STATUSES),
  ...personMexicoFields,
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

export type PersonScheduleValues = {
  entrada?: string | null;
  salidaComer?: string | null;
  regresoComer?: string | null;
  salida?: string | null;
  /** Blocks as stored (jsonb); undefined when the write did not send blocks. */
  blocks?: unknown;
  restDay?: WeekDay | null;
};

export const normalizeTimeValue = (value?: string | null) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 5);
};

export const toPersonScheduleValues = (
  input: Pick<
    PersonFormValues,
    | "horarioEntrada"
    | "horarioSalidaComer"
    | "horarioRegresoComer"
    | "horarioSalida"
    | "horarioBloques"
  >,
): PersonScheduleValues =>
  input.horarioBloques
    ? {
        ...legacyFromBlocks(input.horarioBloques),
        blocks:
          input.horarioBloques.bloques.length > 0
            ? input.horarioBloques.bloques
            : null,
        restDay: input.horarioBloques.diaDescanso,
      }
    : {
        entrada: normalizeTimeValue(input.horarioEntrada),
        salidaComer: normalizeTimeValue(input.horarioSalidaComer),
        regresoComer: normalizeTimeValue(input.horarioRegresoComer),
        salida: normalizeTimeValue(input.horarioSalida),
      };

/** The blocks of a stored schedule: its own, or the simple one read as Monday–Friday. */
export const scheduleBlocksOf = (
  schedule?: PersonScheduleValues | null,
): ScheduleBlocks | null =>
  readStoredBlocks(schedule?.blocks, schedule?.restDay) ??
  blocksFromLegacy(schedule);

export const personScheduleHasTimes = (
  schedule?: PersonScheduleValues | null,
) =>
  Boolean(
    (Array.isArray(schedule?.blocks) && schedule.blocks.length > 0) ||
    normalizeTimeValue(schedule?.entrada) ||
    normalizeTimeValue(schedule?.salidaComer) ||
    normalizeTimeValue(schedule?.regresoComer) ||
    normalizeTimeValue(schedule?.salida),
  );

export const formatTimeLabel = (value?: string | null) =>
  normalizeTimeValue(value) ?? "—";

export const formatHorarioToken = (schedule?: PersonScheduleValues | null) => {
  if (!personScheduleHasTimes(schedule)) {
    return "—";
  }

  const blocks = readStoredBlocks(schedule?.blocks, schedule?.restDay);

  if (blocks && blocks.bloques.length > 0) {
    return formatScheduleBlocks(blocks);
  }

  const parts = [
    `entrada ${formatTimeLabel(schedule?.entrada)}`,
    `salida a comer ${formatTimeLabel(schedule?.salidaComer)}`,
    `regreso de comer ${formatTimeLabel(schedule?.regresoComer)}`,
    `salida ${formatTimeLabel(schedule?.salida)}`,
  ];

  return parts.join(", ");
};

export const formatPersonName = (person: {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno?: string | null;
}) => {
  const parts = [
    person.nombres,
    person.apellidoPaterno,
    person.apellidoMaterno?.trim() || null,
  ].filter(Boolean);

  return parts.join(" ").trim();
};

export const formatDateLabel = formatDateMx;

/** «Calle 5 int. 2, Col. Centro, Tuxtla Gutiérrez, Chiapas, C.P. 29000», or null if nothing. */
export const formatMexicanAddress = (address: {
  domicilioCalle?: string | null;
  domicilioNumeroExterior?: string | null;
  domicilioNumeroInterior?: string | null;
  domicilioColonia?: string | null;
  domicilioMunicipio?: string | null;
  domicilioEstado?: string | null;
  domicilioCodigoPostal?: string | null;
}) => {
  const street = [
    address.domicilioCalle,
    address.domicilioNumeroExterior,
    address.domicilioNumeroInterior
      ? `int. ${address.domicilioNumeroInterior}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const parts = [
    street || null,
    address.domicilioColonia ? `Col. ${address.domicilioColonia}` : null,
    address.domicilioMunicipio,
    address.domicilioEstado,
    address.domicilioCodigoPostal
      ? `C.P. ${address.domicilioCodigoPostal}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
};
