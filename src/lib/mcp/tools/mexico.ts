import { z } from "zod";

import type { Person } from "@/lib/db/schema";
import { formatMexicanAddress } from "@/lib/people/schema";

/**
 * Expediente México in MCP replies (WRK-I1-9): with pii (+ people:update) the
 * data; without it, only whether each item is captured (never the value).
 */
export const datosMexicoSchema = z.object({
  pii_masked: z.boolean(),
  capturado: z.object({
    domicilio: z.boolean(),
    estado_civil: z.boolean(),
    sexo: z.boolean(),
    lugar_nacimiento: z.boolean(),
    nacionalidad: z.boolean(),
    ine: z.boolean(),
    beneficiarios: z.number().int(),
  }),
  domicilio: z
    .object({
      calle: z.string().nullable(),
      numero_exterior: z.string().nullable(),
      numero_interior: z.string().nullable(),
      colonia: z.string().nullable(),
      municipio: z.string().nullable(),
      estado: z.string().nullable(),
      codigo_postal: z.string().nullable(),
      texto: z.string().nullable(),
    })
    .optional(),
  estado_civil: z.string().nullable().optional(),
  sexo: z.string().nullable().optional(),
  lugar_nacimiento: z.string().nullable().optional(),
  nacionalidad: z.string().nullable().optional(),
  ine_clave_elector: z.string().nullable().optional(),
  beneficiarios: z
    .array(
      z.object({
        nombre: z.string(),
        parentesco: z.string(),
        porcentaje: z.number(),
      }),
    )
    .optional(),
});

type Beneficiary = { nombre: string; parentesco: string; porcentaje: number };

export const datosMexico = (
  person: Pick<
    Person,
    | "domicilioCalle"
    | "domicilioNumeroExterior"
    | "domicilioNumeroInterior"
    | "domicilioColonia"
    | "domicilioMunicipio"
    | "domicilioEstado"
    | "domicilioCodigoPostal"
    | "estadoCivil"
    | "sexo"
    | "lugarNacimiento"
    | "nacionalidad"
    | "ineClaveElector"
  >,
  beneficiaries: Beneficiary[],
  unmasked: boolean,
): z.infer<typeof datosMexicoSchema> => {
  const address = formatMexicanAddress(person);
  const capturado = {
    domicilio: address !== null,
    estado_civil: Boolean(person.estadoCivil),
    sexo: Boolean(person.sexo),
    lugar_nacimiento: Boolean(person.lugarNacimiento),
    nacionalidad: Boolean(person.nacionalidad),
    ine: Boolean(person.ineClaveElector),
    beneficiarios: beneficiaries.length,
  };

  if (!unmasked) {
    return { pii_masked: true, capturado };
  }

  return {
    pii_masked: false,
    capturado,
    domicilio: {
      calle: person.domicilioCalle,
      numero_exterior: person.domicilioNumeroExterior,
      numero_interior: person.domicilioNumeroInterior,
      colonia: person.domicilioColonia,
      municipio: person.domicilioMunicipio,
      estado: person.domicilioEstado,
      codigo_postal: person.domicilioCodigoPostal,
      texto: address,
    },
    estado_civil: person.estadoCivil,
    sexo: person.sexo,
    lugar_nacimiento: person.lugarNacimiento,
    nacionalidad: person.nacionalidad,
    ine_clave_elector: person.ineClaveElector,
    beneficiarios: beneficiaries.map(({ nombre, parentesco, porcentaje }) => ({
      nombre,
      parentesco,
      porcentaje,
    })),
  };
};

/** Write fields of the expediente México, in MCP snake_case. */
export const mexicoWriteFields = {
  domicilio_calle: z.string().trim().max(160),
  domicilio_numero_exterior: z.string().trim().max(20),
  domicilio_numero_interior: z.string().trim().max(20),
  domicilio_colonia: z.string().trim().max(120),
  domicilio_municipio: z.string().trim().max(120),
  domicilio_estado: z
    .string()
    .trim()
    .max(60)
    .describe("Una de las 32 entidades, p. ej. «Chiapas»."),
  domicilio_codigo_postal: z.string().trim().max(5),
  estado_civil: z.enum([
    "soltero",
    "casado",
    "union_libre",
    "divorciado",
    "viudo",
  ]),
  sexo: z.enum(["H", "M"]),
  lugar_nacimiento: z.string().trim().max(60),
  nacionalidad: z.string().trim().max(60),
  ine_clave_elector: z.string().trim().max(20),
  beneficiarios: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(160),
        parentesco: z.string().trim().min(1).max(60),
        porcentaje: z.number().gt(0).max(100),
      }),
    )
    .max(10)
    .describe("Reemplaza la lista completa; los porcentajes suman 100."),
};

/** MCP field → PersonFormValues key. */
export const MEXICO_FIELD_MAP = {
  domicilio_calle: "domicilioCalle",
  domicilio_numero_exterior: "domicilioNumeroExterior",
  domicilio_numero_interior: "domicilioNumeroInterior",
  domicilio_colonia: "domicilioColonia",
  domicilio_municipio: "domicilioMunicipio",
  domicilio_estado: "domicilioEstado",
  domicilio_codigo_postal: "domicilioCodigoPostal",
  estado_civil: "estadoCivil",
  sexo: "sexo",
  lugar_nacimiento: "lugarNacimiento",
  nacionalidad: "nacionalidad",
  ine_clave_elector: "ineClaveElector",
  beneficiarios: "beneficiarios",
} as const;
