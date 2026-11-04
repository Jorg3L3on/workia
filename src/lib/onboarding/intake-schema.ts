import { z } from "zod";

import { formatDateMx } from "@/lib/format/date";

import type {
  OnboardingIntakeReturnReason,
  OnboardingIntakeStatus,
} from "@/lib/db/schema/onboarding-intakes";
import {
  beneficiarySchema,
  MARITAL_STATUSES,
  maritalStatusLabels,
  MX_STATES,
  personFieldsSchema,
  type PersonFormValues,
  SEXES,
  sexLabels,
} from "@/lib/people/schema";

/**
 * The self-service onboarding form (W2-10): the personal and expediente
 * México fields a new hire can fill from /mi. HR keeps the rest (name,
 * CURP, puesto, sucursal, ingreso, schedule, salary). Each value is
 * validated with the person form's own rules, so what HR applies is what the
 * person form would accept.
 */
export const INTAKE_SECTIONS = [
  "personales",
  "domicilio",
  "beneficiarios",
] as const;

export type IntakeSection = (typeof INTAKE_SECTIONS)[number];

export const intakeSectionLabels: Record<IntakeSection, string> = {
  personales: "Datos personales",
  domicilio: "Domicilio",
  beneficiarios: "Beneficiarios",
};

type FieldKind = "text" | "date" | "tel" | "select";

export type IntakeField = {
  key: IntakeFieldKey;
  label: string;
  section: IntakeSection;
  kind: FieldKind;
  /** Needed to send the form. */
  required: boolean;
  options?: readonly { value: string; label: string }[];
  hint?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "tel" | "text";
  maxLength?: number;
};

const stateOptions = MX_STATES.map((value) => ({ value, label: value }));

/** Every field of the form, in the order the employee sees it. */
export const INTAKE_FIELDS = [
  {
    key: "telefono",
    label: "Teléfono celular",
    section: "personales",
    kind: "tel",
    required: true,
    autoComplete: "tel",
    inputMode: "tel",
    maxLength: 20,
  },
  {
    key: "fechaNacimiento",
    label: "Fecha de nacimiento",
    section: "personales",
    kind: "date",
    required: true,
    autoComplete: "bday",
  },
  {
    key: "sexo",
    label: "Sexo (como aparece en tu CURP)",
    section: "personales",
    kind: "select",
    required: true,
    options: SEXES.map((value) => ({ value, label: sexLabels[value] })),
  },
  {
    key: "estadoCivil",
    label: "Estado civil",
    section: "personales",
    kind: "select",
    required: true,
    options: MARITAL_STATUSES.map((value) => ({
      value,
      label: maritalStatusLabels[value],
    })),
  },
  {
    key: "lugarNacimiento",
    label: "Estado donde naciste",
    section: "personales",
    kind: "select",
    required: true,
    options: stateOptions,
  },
  {
    key: "nacionalidad",
    label: "Nacionalidad",
    section: "personales",
    kind: "text",
    required: true,
    maxLength: 60,
  },
  {
    key: "rfc",
    label: "RFC",
    section: "personales",
    kind: "text",
    required: true,
    hint: "13 letras y números, como en tu constancia de situación fiscal.",
    maxLength: 13,
  },
  {
    key: "nss",
    label: "Número de seguridad social (NSS)",
    section: "personales",
    kind: "text",
    required: true,
    hint: "11 dígitos.",
    inputMode: "numeric",
    maxLength: 11,
  },
  {
    key: "ineClaveElector",
    label: "Clave de elector (INE)",
    section: "personales",
    kind: "text",
    required: true,
    hint: "18 letras y números, al frente de tu credencial.",
    maxLength: 18,
  },
  {
    key: "domicilioCalle",
    label: "Calle",
    section: "domicilio",
    kind: "text",
    required: true,
    autoComplete: "address-line1",
    maxLength: 160,
  },
  {
    key: "domicilioNumeroExterior",
    label: "Número exterior",
    section: "domicilio",
    kind: "text",
    required: true,
    maxLength: 20,
  },
  {
    key: "domicilioNumeroInterior",
    label: "Número interior",
    section: "domicilio",
    kind: "text",
    required: false,
    maxLength: 20,
  },
  {
    key: "domicilioColonia",
    label: "Colonia",
    section: "domicilio",
    kind: "text",
    required: true,
    maxLength: 120,
  },
  {
    key: "domicilioMunicipio",
    label: "Municipio o alcaldía",
    section: "domicilio",
    kind: "text",
    required: true,
    autoComplete: "address-level2",
    maxLength: 120,
  },
  {
    key: "domicilioEstado",
    label: "Estado",
    section: "domicilio",
    kind: "select",
    required: true,
    options: stateOptions,
  },
  {
    key: "domicilioCodigoPostal",
    label: "Código postal",
    section: "domicilio",
    kind: "text",
    required: true,
    autoComplete: "postal-code",
    inputMode: "numeric",
    maxLength: 5,
  },
] as const satisfies readonly (Omit<IntakeField, "key"> & {
  key: string;
})[];

export type IntakeFieldKey = (typeof INTAKE_FIELDS)[number]["key"];

export const INTAKE_FIELD_KEYS = INTAKE_FIELDS.map(
  (field) => field.key,
) as IntakeFieldKey[];

/** Beneficiaries count as one field of the form; the list is optional. */
export const INTAKE_BENEFICIARY_SLOTS = 3;

/** Fields the form counts for the 80 percent goal: every field plus beneficiaries. */
export const INTAKE_FIELDS_TOTAL = INTAKE_FIELDS.length + 1;

const fieldSchemas = personFieldsSchema.pick({
  telefono: true,
  fechaNacimiento: true,
  sexo: true,
  estadoCivil: true,
  lugarNacimiento: true,
  nacionalidad: true,
  rfc: true,
  nss: true,
  ineClaveElector: true,
  domicilioCalle: true,
  domicilioNumeroExterior: true,
  domicilioNumeroInterior: true,
  domicilioColonia: true,
  domicilioMunicipio: true,
  domicilioEstado: true,
  domicilioCodigoPostal: true,
});

/** What the employee saves: every field optional, each checked on its own. */
export const intakeDraftSchema = fieldSchemas
  .extend({
    beneficiarios: z
      .array(beneficiarySchema)
      .max(INTAKE_BENEFICIARY_SLOTS)
      .optional()
      .refine(
        (list) =>
          !list ||
          list.length === 0 ||
          Math.abs(list.reduce((sum, item) => sum + item.porcentaje, 0) - 100) <
            0.01,
        "Los porcentajes de los beneficiarios deben sumar 100",
      ),
  })
  .strict();

export type IntakeData = z.infer<typeof intakeDraftSchema>;

export const INTAKE_REQUIRED_MESSAGE = "Este dato es obligatorio para enviar.";

/** What «Enviar a RH» needs: the draft rules plus every required field. */
export const intakeSubmitSchema = intakeDraftSchema.superRefine((data, ctx) => {
  for (const field of INTAKE_FIELDS) {
    if (field.required && !hasValue(data[field.key])) {
      ctx.addIssue({
        code: "custom",
        path: [field.key],
        message: INTAKE_REQUIRED_MESSAGE,
      });
    }
  }
});

const hasValue = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === "string"
      ? value.trim() !== ""
      : value !== undefined && value !== null;

/**
 * How many of the form's fields hold a value from the person: the
 * acceptance criterion of W2-10 (an alta from self-service has at least 80
 * percent of its fields filled by the employee).
 */
export const countIntakeFields = (data: Partial<IntakeData>) => ({
  total: INTAKE_FIELDS_TOTAL,
  filled:
    INTAKE_FIELDS.filter((field) => hasValue(data[field.key])).length +
    (hasValue(data.beneficiarios) ? 1 : 0),
});

export const intakeShare = ({
  filled,
  total,
}: {
  filled: number;
  total: number;
}) => (total === 0 ? 0 : Math.round((filled / total) * 100));

/** Reads stored jsonb back as draft values, dropping anything that no longer validates. */
export const readIntakeData = (raw: unknown): Partial<IntakeData> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};

  const shape = intakeDraftSchema.shape as Record<string, z.ZodType>;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = shape[key]?.safeParse(value);
    if (parsed?.success && parsed.data !== undefined) out[key] = parsed.data;
  }

  return out as Partial<IntakeData>;
};

/**
 * The person form with the employee's values on top of what is stored: a
 * field the person left empty keeps HR's value; beneficiaries replace the
 * stored list only when the person sent some.
 */
export const mergeIntakeIntoPerson = (
  stored: PersonFormValues,
  data: Partial<IntakeData>,
): PersonFormValues => {
  const merged: Record<string, unknown> = { ...stored };

  for (const field of INTAKE_FIELDS) {
    const value = data[field.key];
    if (typeof value === "string" && value.trim() !== "") {
      merged[field.key] = value;
    }
  }

  if (data.beneficiarios && data.beneficiarios.length > 0) {
    merged.beneficiarios = data.beneficiarios;
  }

  return merged as PersonFormValues;
};

/** The person form's value of a field, as text for display. */
export const formatIntakeValue = (
  key: IntakeFieldKey,
  value: unknown,
): string => {
  if (typeof value !== "string" || value === "") return "";
  const field = INTAKE_FIELDS.find((candidate) => candidate.key === key);
  if (field?.kind === "date") return formatDateMx(value);
  const options = field && "options" in field ? field.options : undefined;
  return options?.find((option) => option.value === value)?.label ?? value;
};

export const intakeStatusLabels: Record<OnboardingIntakeStatus, string> = {
  invitado: "Esperando a la persona",
  enviado: "Por revisar",
  devuelto: "Devuelto a la persona",
  aplicado: "Aplicado al expediente",
};

/** The same statuses as the employee reads them on /mi. */
export const intakeEmployeeLabels: Record<OnboardingIntakeStatus, string> = {
  invitado: "Llena tus datos y sube tus documentos antes de tu primer día.",
  enviado: "Enviado. RH lo está revisando.",
  devuelto: "RH te pidió corregir algo. Revisa y vuelve a enviar.",
  aplicado: "Listo.",
};

export const intakeReturnReasonLabels: Record<
  OnboardingIntakeReturnReason,
  string
> = {
  incompleto: "Faltan datos",
  datos_incorrectos: "Hay datos incorrectos",
  identificador_duplicado: "El RFC o el NSS ya está en otro expediente",
};

export const INTAKE_COPY = {
  notOpen: "Tu alta ya no está abierta para capturar datos.",
  locked: "Ya enviaste tus datos. RH los está revisando.",
  sent: "Listo. Enviaste tus datos a RH.",
  saved: "Guardado. Puedes seguir después.",
  noticePending:
    "Antes de capturar tus datos, lee y acepta el aviso de privacidad.",
  noNotice:
    "Tu empresa aún no publica su aviso de privacidad. Pide a RH que lo publique para continuar.",
  hrNotOpen:
    "El autoservicio solo se abre mientras el alta está en Captura RH.",
  hrExists: "Esta alta ya tiene autoservicio.",
  hrNotSent: "La persona todavía no envía sus datos.",
  hrNeedsReview:
    "La persona envió sus datos: revísalos y aplícalos (o devuélvelos) antes de aprobar.",
} as const;
