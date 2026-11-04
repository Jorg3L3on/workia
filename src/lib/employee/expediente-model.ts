import type { PersonFormSection } from "@/components/people/person-detail-model";
import {
  contractStatusLabels,
  contractTypeLabels,
} from "@/lib/contracts/schema";
import type { ContractStatus, ContractType } from "@/lib/db/schema/contracts";
import { formatDateMx } from "@/lib/format/date";
import {
  formatHorarioToken,
  formatMexicanAddress,
  formatPersonName,
  maritalStatusLabels,
  sexLabels,
  type PersonScheduleValues,
} from "@/lib/people/schema";
import { formatSeniority } from "@/lib/people/seniority";

/**
 * Mi expediente (Workia 2.0 W2-02): every field the employee sees, the
 * Postgres columns it comes from, and whether they can ask HR to correct it.
 * Pure, so the page, the correction request and the tests read the same list.
 * A test checks that each source is a real column of the schema.
 */

/** `table.column`, as named in Postgres. */
export type ExpedienteSource = `${string}.${string}`;

export type ExpedienteGroup = "personal" | "contacto" | "trabajo" | "contrato";

export const EXPEDIENTE_GROUPS: Record<ExpedienteGroup, string> = {
  personal: "Datos personales",
  contacto: "Contacto y domicilio",
  trabajo: "Trabajo",
  contrato: "Contrato",
};

export type ExpedienteField = {
  key: string;
  label: string;
  group: ExpedienteGroup;
  /** Every column the value is built from. */
  sources: readonly ExpedienteSource[];
  /**
   * Where HR fixes it in the person form (`?edit=1&seccion=…&campo=…`).
   * Without one the field is not correctable from the app (computed, or a
   * signed contract).
   */
  hr?: { section: PersonFormSection; field?: string };
  /** A short hint on the correction form. */
  hint?: string;
};

export const EXPEDIENTE_FIELDS = [
  // Datos personales
  {
    key: "nombres",
    label: "Nombre(s)",
    group: "personal",
    sources: ["people.nombres"],
    hr: { section: "nombre", field: "nombres" },
  },
  {
    key: "apellidoPaterno",
    label: "Apellido paterno",
    group: "personal",
    sources: ["people.apellido_paterno"],
    hr: { section: "nombre", field: "apellidoPaterno" },
  },
  {
    key: "apellidoMaterno",
    label: "Apellido materno",
    group: "personal",
    sources: ["people.apellido_materno"],
    hr: { section: "nombre", field: "apellidoMaterno" },
  },
  {
    key: "fechaNacimiento",
    label: "Fecha de nacimiento",
    group: "personal",
    sources: ["people.fecha_nacimiento"],
    hr: { section: "empresa", field: "fechaNacimiento" },
    hint: "Escríbela como dd/mm/aaaa.",
  },
  {
    key: "curp",
    label: "CURP",
    group: "personal",
    sources: ["people.curp"],
    hr: { section: "identificadores", field: "curp" },
    hint: "18 caracteres, como aparece en tu constancia de CURP.",
  },
  {
    key: "rfc",
    label: "RFC",
    group: "personal",
    sources: ["people.rfc"],
    hr: { section: "identificadores", field: "rfc" },
    hint: "13 caracteres, con homoclave.",
  },
  {
    key: "nss",
    label: "Número de seguridad social (NSS)",
    group: "personal",
    sources: ["people.nss"],
    hr: { section: "identificadores", field: "nss" },
    hint: "11 dígitos.",
  },
  {
    key: "sexo",
    label: "Sexo",
    group: "personal",
    sources: ["people.sexo"],
    hr: { section: "datos-mexico", field: "sexo" },
  },
  {
    key: "estadoCivil",
    label: "Estado civil",
    group: "personal",
    sources: ["people.estado_civil"],
    hr: { section: "datos-mexico", field: "estadoCivil" },
  },
  {
    key: "lugarNacimiento",
    label: "Lugar de nacimiento",
    group: "personal",
    sources: ["people.lugar_nacimiento"],
    hr: { section: "datos-mexico", field: "lugarNacimiento" },
  },
  {
    key: "nacionalidad",
    label: "Nacionalidad",
    group: "personal",
    sources: ["people.nacionalidad"],
    hr: { section: "datos-mexico", field: "nacionalidad" },
  },
  // Contacto y domicilio
  {
    key: "email",
    label: "Correo personal",
    group: "contacto",
    sources: ["people.email"],
    hr: { section: "identificadores", field: "email" },
    hint: "El correo con el que entras a la app lo cambia RH aparte.",
  },
  {
    key: "telefono",
    label: "Teléfono",
    group: "contacto",
    sources: ["people.telefono"],
    hr: { section: "identificadores", field: "telefono" },
  },
  {
    key: "domicilio",
    label: "Domicilio",
    group: "contacto",
    sources: [
      "people.domicilio_calle",
      "people.domicilio_numero_exterior",
      "people.domicilio_numero_interior",
      "people.domicilio_colonia",
      "people.domicilio_municipio",
      "people.domicilio_estado",
      "people.domicilio_codigo_postal",
    ],
    hr: { section: "datos-mexico", field: "domicilioCalle" },
    hint: "Calle, número, colonia, municipio, estado y código postal.",
  },
  {
    key: "accountEmail",
    label: "Correo de acceso a la app",
    group: "contacto",
    sources: ["employee_accounts.email"],
  },
  // Trabajo
  {
    key: "empresa",
    label: "Empresa",
    group: "trabajo",
    sources: ["companies.name"],
  },
  {
    key: "puesto",
    label: "Puesto",
    group: "trabajo",
    sources: ["people.position_id", "positions.name"],
    hr: { section: "empresa", field: "positionId" },
  },
  {
    key: "area",
    label: "Área",
    group: "trabajo",
    sources: ["people.area_id", "areas.name"],
    hr: { section: "empresa", field: "areaId" },
  },
  {
    key: "sucursal",
    label: "Sucursal",
    group: "trabajo",
    sources: ["people.site_id", "sites.name"],
    hr: { section: "empresa", field: "siteId" },
  },
  {
    key: "jefe",
    label: "Jefe directo",
    group: "trabajo",
    sources: [
      "people.manager_id",
      "people.nombres",
      "people.apellido_paterno",
      "people.apellido_materno",
    ],
    hr: { section: "empresa", field: "managerId" },
  },
  {
    key: "horario",
    label: "Horario",
    group: "trabajo",
    sources: [
      "person_schedules.blocks",
      "person_schedules.rest_day",
      "person_schedules.entrada",
      "person_schedules.salida_comer",
      "person_schedules.regreso_comer",
      "person_schedules.salida",
    ],
    hr: { section: "horario" },
  },
  {
    key: "fechaIngreso",
    label: "Fecha de ingreso",
    group: "trabajo",
    sources: ["employment_periods.fecha_ingreso", "people.fecha_ingreso"],
    hr: { section: "empresa", field: "fechaIngreso" },
    hint: "Escríbela como dd/mm/aaaa.",
  },
  {
    key: "antiguedad",
    label: "Antigüedad",
    group: "trabajo",
    sources: [
      "employment_periods.fecha_ingreso",
      "employment_periods.reconoce_antiguedad",
      "employment_periods.fecha_antiguedad_reconocida",
      "people.fecha_ingreso",
    ],
  },
  // Contrato (the vigente one; amounts are never shown here)
  {
    key: "contratoTipo",
    label: "Tipo de contrato",
    group: "contrato",
    sources: ["contracts.type", "contracts.status"],
  },
  {
    key: "contratoInicio",
    label: "Inicio",
    group: "contrato",
    sources: ["contracts.start_date"],
  },
  {
    key: "contratoFin",
    label: "Fin",
    group: "contrato",
    sources: ["contracts.end_date"],
  },
] as const satisfies readonly ExpedienteField[];

export type ExpedienteFieldKey = (typeof EXPEDIENTE_FIELDS)[number]["key"];

const FIELD_BY_KEY = new Map<string, ExpedienteField>(
  EXPEDIENTE_FIELDS.map((field) => [field.key, field]),
);

export const expedienteField = (key: string | null | undefined) =>
  key ? (FIELD_BY_KEY.get(key) ?? null) : null;

/** A field the employee can ask HR to correct. */
export const correctableField = (key: string | null | undefined) => {
  const field = expedienteField(key);

  return field?.hr ? field : null;
};

/** Everything the expediente reads, as the query returns it. */
export type ExpedienteData = {
  person: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    fechaNacimiento: string | null;
    fechaIngreso: string | null;
    curp: string | null;
    rfc: string | null;
    nss: string | null;
    sexo: keyof typeof sexLabels | null;
    estadoCivil: keyof typeof maritalStatusLabels | null;
    lugarNacimiento: string | null;
    nacionalidad: string | null;
    email: string | null;
    telefono: string | null;
    domicilioCalle: string | null;
    domicilioNumeroExterior: string | null;
    domicilioNumeroInterior: string | null;
    domicilioColonia: string | null;
    domicilioMunicipio: string | null;
    domicilioEstado: string | null;
    domicilioCodigoPostal: string | null;
    status: "activa" | "baja";
  };
  companyName: string;
  accountEmail: string | null;
  positionName: string | null;
  areaName: string | null;
  siteName: string | null;
  manager: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  } | null;
  schedule: PersonScheduleValues | null;
  /** The current (or last) employment period; null before any exists. */
  period: {
    fechaIngreso: string | null;
    fechaAntiguedad: string | null;
  } | null;
  /** The vigente contract; never its amounts. */
  contract: {
    type: ContractType;
    status: ContractStatus;
    startDate: string;
    endDate: string | null;
  } | null;
};

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

/**
 * Each field's value as the employee reads it, or null when HR has not
 * captured it. The same text is stored as «antes» on a correction request.
 */
export const expedienteValues = (
  data: ExpedienteData,
  today: string,
): Record<ExpedienteFieldKey, string | null> => {
  const { person } = data;
  const fechaIngreso = data.period?.fechaIngreso ?? person.fechaIngreso;
  const seniorityDate = data.period
    ? data.period.fechaAntiguedad
    : person.fechaIngreso;
  const horario = formatHorarioToken(data.schedule);
  const date = (value: string | null) => (value ? formatDateMx(value) : null);

  return {
    nombres: clean(person.nombres),
    apellidoPaterno: clean(person.apellidoPaterno),
    apellidoMaterno: clean(person.apellidoMaterno),
    fechaNacimiento: date(person.fechaNacimiento),
    curp: clean(person.curp),
    rfc: clean(person.rfc),
    nss: clean(person.nss),
    sexo: person.sexo ? sexLabels[person.sexo] : null,
    estadoCivil: person.estadoCivil
      ? maritalStatusLabels[person.estadoCivil]
      : null,
    lugarNacimiento: clean(person.lugarNacimiento),
    nacionalidad: clean(person.nacionalidad),
    email: clean(person.email),
    telefono: clean(person.telefono),
    domicilio: formatMexicanAddress(person),
    accountEmail: clean(data.accountEmail),
    empresa: clean(data.companyName),
    puesto: clean(data.positionName),
    area: clean(data.areaName),
    sucursal: clean(data.siteName),
    jefe: data.manager ? formatPersonName(data.manager) : null,
    horario: horario === "—" ? null : horario,
    fechaIngreso: date(fechaIngreso),
    antiguedad:
      seniorityDate && person.status === "activa"
        ? formatSeniority(seniorityDate, today)
        : null,
    contratoTipo: data.contract
      ? `${contractTypeLabels[data.contract.type]} · ${contractStatusLabels[data.contract.status].toLocaleLowerCase("es-MX")}`
      : null,
    contratoInicio: data.contract ? date(data.contract.startDate) : null,
    contratoFin: data.contract
      ? data.contract.endDate
        ? formatDateMx(data.contract.endDate)
        : "Sin fecha de fin"
      : null,
  };
};

export type ExpedienteRow = {
  key: ExpedienteFieldKey;
  label: string;
  value: string | null;
  correctable: boolean;
};

export type ExpedienteSection = {
  group: ExpedienteGroup;
  title: string;
  rows: ExpedienteRow[];
};

/**
 * The page's sections, in EXPEDIENTE_FIELDS order. The contract section is
 * left out when there is no vigente contract; every other field shows, with
 * «Sin capturar» when empty, so the employee can ask for it.
 */
export const expedienteSections = (
  data: ExpedienteData,
  today: string,
): ExpedienteSection[] => {
  const values = expedienteValues(data, today);

  return (Object.keys(EXPEDIENTE_GROUPS) as ExpedienteGroup[])
    .filter((group) => group !== "contrato" || data.contract)
    .map((group) => ({
      group,
      title: EXPEDIENTE_GROUPS[group],
      rows: EXPEDIENTE_FIELDS.filter((field) => field.group === group).map(
        (field) => ({
          key: field.key,
          label: field.label,
          value: values[field.key],
          correctable: "hr" in field,
        }),
      ),
    }));
};
