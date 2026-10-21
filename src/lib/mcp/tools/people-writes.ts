import { z } from "zod";

import { getVigenteContractForPerson } from "@/lib/contracts";
import { catalogKey } from "@/lib/import/format";
import {
  createPerson,
  getPersonWithRelations,
  setPersonStatus,
  updatePerson,
  upsertPersonSchedule,
  type PersonStatusChange,
  type PersonWithRelations as MaybePerson,
} from "@/lib/people";
import { listEmploymentPeriods, rehireWarnings } from "@/lib/people/employment";
import {
  FINIQUITO_STATUSES,
  rehireSchema,
  TERMINATION_TYPES,
  terminationSchema,
  terminationTypeLabels,
} from "@/lib/people/employment-schema";
import { listAssetsByPerson } from "@/lib/resguardo";
import { listTerminationReasons } from "@/lib/termination-reasons";
import {
  formatHorarioToken,
  personFormSchema,
  type PersonFormValues,
} from "@/lib/people/schema";

import { McpToolError, notFound } from "../errors";
import {
  defineWriteTool,
  writeAnnotations,
  type WorkiaToolContext,
} from "../run-tool";
import { appUrl, fullName, isoDate, mx, uuid } from "./common";
import { assertCompensationAccess } from "./compensation";
import { MEXICO_FIELD_MAP, mexicoWriteFields } from "./mexico";
import {
  bloquesInput,
  diaDescansoInput,
  horarioBloques,
  horarioBloquesSchema,
  toScheduleBlocks,
} from "./schedule";

type PersonWithRelations = NonNullable<MaybePerson>;

const time = (label: string) =>
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa HH:mm.")
    .describe(label);

const personRef = z.object({
  id: z.string(),
  nombre_completo: z.string(),
  status: z.string(),
  url: z.string(),
});

const toRef = (
  ctx: WorkiaToolContext,
  person: {
    id: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    status: string;
  },
) => ({
  id: person.id,
  nombre_completo: fullName(person),
  status: person.status,
  url: appUrl(ctx, `/app/personas/${person.id}`),
});

/**
 * RFC, CURP, NSS and the expediente México (domicilio, datos civiles, INE,
 * beneficiarios) are only written by a connection that may see them (pii).
 */
const assertIdentifiersAllowed = (
  ctx: WorkiaToolContext,
  values: Record<string, unknown>,
) => {
  const protectedFields = [
    "rfc",
    "curp",
    "nss",
    ...Object.keys(MEXICO_FIELD_MAP),
  ];
  const sent = protectedFields.filter(
    (field) =>
      values[field] !== undefined &&
      values[field] !== null &&
      values[field] !== "",
  );

  if (sent.length > 0 && !ctx.piiUnmasked) {
    throw new McpToolError(
      "FORBIDDEN_SCOPE",
      "Para capturar RFC, CURP, NSS o datos México la conexión necesita el scope pii.",
      { details: { required_scope: "pii", fields: sent } },
    );
  }
};

/** The whole form as the app would submit it, from the person as stored. */
const formFromPerson = (person: PersonWithRelations): PersonFormValues => ({
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  apellidoMaterno: person.apellidoMaterno ?? "",
  email: person.email ?? "",
  telefono: person.telefono ?? "",
  fechaNacimiento: person.fechaNacimiento ?? "",
  fechaIngreso: person.fechaIngreso ?? "",
  areaId: person.areaId ?? "",
  positionId: person.positionId ?? "",
  managerId: person.managerId ?? "",
  siteId: person.siteId ?? "",
  rfc: person.rfc ?? "",
  curp: person.curp ?? "",
  nss: person.nss ?? "",
  horarioEntrada: person.schedule?.entrada ?? "",
  horarioSalidaComer: person.schedule?.salidaComer ?? "",
  horarioRegresoComer: person.schedule?.regresoComer ?? "",
  horarioSalida: person.schedule?.salida ?? "",
  status: person.status,
  domicilioCalle: person.domicilioCalle ?? "",
  domicilioNumeroExterior: person.domicilioNumeroExterior ?? "",
  domicilioNumeroInterior: person.domicilioNumeroInterior ?? "",
  domicilioColonia: person.domicilioColonia ?? "",
  domicilioMunicipio: person.domicilioMunicipio ?? "",
  domicilioEstado: (person.domicilioEstado ??
    "") as PersonFormValues["domicilioEstado"],
  domicilioCodigoPostal: person.domicilioCodigoPostal ?? "",
  estadoCivil: person.estadoCivil ?? "",
  sexo: person.sexo ?? "",
  lugarNacimiento: (person.lugarNacimiento ??
    "") as PersonFormValues["lugarNacimiento"],
  nacionalidad: person.nacionalidad ?? "",
  ineClaveElector: person.ineClaveElector ?? "",
});

const loadPerson = async (ctx: WorkiaToolContext, personId: string) => {
  const person = await getPersonWithRelations(ctx.companyId, personId);

  if (!person) {
    throw notFound("La persona");
  }

  return person;
};

/**
 * Validates with the app's own schema; its messages become VALIDATION details.
 * With `changed`, only those fields are judged: a value already stored that
 * today's rules would reject (legacy or imported data) does not block an
 * unrelated edit, and is written back as it was.
 */
const parseForm = (
  values: PersonFormValues,
  changed?: ReadonlyArray<keyof PersonFormValues>,
) => {
  const fail = (issues: { path: PropertyKey[]; message: string }[]) =>
    new McpToolError("VALIDATION", "Los datos de la persona no son válidos.", {
      details: {
        issues: issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  const parsed = personFormSchema.safeParse(values);

  if (parsed.success) {
    return parsed.data;
  }

  const judged = changed
    ? parsed.error.issues.filter((issue) =>
        changed.includes(issue.path[0] as keyof PersonFormValues),
      )
    : parsed.error.issues;

  if (judged.length > 0) {
    throw fail(judged);
  }

  // Only untouched stored values failed: validate the rest without them.
  const untouched = new Set(
    parsed.error.issues.map((issue) => issue.path[0] as keyof PersonFormValues),
  );
  const cleared = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      untouched.has(key as keyof PersonFormValues) ? "" : value,
    ]),
  ) as PersonFormValues;
  const retried = personFormSchema.safeParse(cleared);

  if (!retried.success) {
    throw fail(retried.error.issues);
  }

  return {
    ...retried.data,
    ...Object.fromEntries([...untouched].map((key) => [key, values[key]])),
  } as PersonFormValues;
};

const personFields = {
  nombres: z.string().trim().min(1).max(120),
  apellido_paterno: z.string().trim().min(1).max(120),
  apellido_materno: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  telefono: z.string().trim().max(40).optional(),
  fecha_nacimiento: isoDate("Fecha de nacimiento (aaaa-mm-dd).").optional(),
  fecha_ingreso: isoDate("Fecha de ingreso (aaaa-mm-dd).").optional(),
  area_id: uuid("Área.").optional(),
  position_id: uuid("Puesto.").optional(),
  manager_id: uuid("Jefe directo.").optional(),
  site_id: uuid("Sucursal o corporativo.").optional(),
  rfc: z.string().trim().max(13).optional().describe("Sólo con el scope pii."),
  curp: z.string().trim().max(18).optional().describe("Sólo con el scope pii."),
  nss: z.string().trim().max(11).optional().describe("Sólo con el scope pii."),
  ...Object.fromEntries(
    Object.entries(mexicoWriteFields).map(([key, schema]) => [
      key,
      schema
        .optional()
        .describe(
          `${schema.description ?? "Datos México"} Sólo con el scope pii.`,
        ),
    ]),
  ),
} as Record<string, z.ZodType>;

const createInput = z.object(personFields) as unknown as z.ZodObject<{
  nombres: z.ZodString;
  apellido_paterno: z.ZodString;
  apellido_materno: z.ZodOptional<z.ZodString>;
  email: z.ZodOptional<z.ZodString>;
  telefono: z.ZodOptional<z.ZodString>;
  fecha_nacimiento: z.ZodOptional<z.ZodString>;
  fecha_ingreso: z.ZodOptional<z.ZodString>;
  area_id: z.ZodOptional<z.ZodString>;
  position_id: z.ZodOptional<z.ZodString>;
  manager_id: z.ZodOptional<z.ZodString>;
  site_id: z.ZodOptional<z.ZodString>;
  rfc: z.ZodOptional<z.ZodString>;
  curp: z.ZodOptional<z.ZodString>;
  nss: z.ZodOptional<z.ZodString>;
}>;

/** The expediente México fields an MCP call sent, as PersonFormValues. */
const mexicoFormValues = (args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(MEXICO_FIELD_MAP)
      .filter(([field]) => args[field] !== undefined)
      .map(([field, key]) => [
        key,
        args[field] ?? (key === "beneficiarios" ? [] : ""),
      ]),
  ) as Partial<PersonFormValues>;

const toFormValues = (args: z.infer<typeof createInput>): PersonFormValues => ({
  nombres: args.nombres,
  apellidoPaterno: args.apellido_paterno,
  apellidoMaterno: args.apellido_materno ?? "",
  email: args.email ?? "",
  telefono: args.telefono ?? "",
  fechaNacimiento: args.fecha_nacimiento ?? "",
  fechaIngreso: args.fecha_ingreso ?? "",
  areaId: args.area_id ?? "",
  positionId: args.position_id ?? "",
  managerId: args.manager_id ?? "",
  siteId: args.site_id ?? "",
  rfc: args.rfc ?? "",
  curp: args.curp ?? "",
  nss: args.nss ?? "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...mexicoFormValues(args as Record<string, unknown>),
});

export const createPersonTool = defineWriteTool({
  name: "create_person",
  title: "Alta de persona",
  description:
    "Da de alta un expediente con las mismas reglas que la app (D-04). RFC, CURP y NSS sólo con el scope pii. CONFLICT si un RFC, CURP o NSS ya es de otra persona activa. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:create",
  input: createInput,
  output: z.object({ person: personRef }),
  annotations: writeAnnotations("Alta de persona"),
  preview: async (args, ctx) => {
    assertIdentifiersAllowed(ctx, args);
    parseForm(toFormValues(args));

    return {
      summary: [
        `Alta de ${fullName({ nombres: args.nombres, apellidoPaterno: args.apellido_paterno, apellidoMaterno: args.apellido_materno })}`,
        args.fecha_ingreso ? `ingreso ${mx(args.fecha_ingreso)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  },
  handler: async (args, ctx) => {
    assertIdentifiersAllowed(ctx, args);
    const created = await createPerson(
      ctx.companyId,
      parseForm(toFormValues(args)),
      ctx.userId,
    );

    return { person: toRef(ctx, created) };
  },
});

const changesSchema = z
  .object({
    nombres: personFields.nombres,
    apellido_paterno: personFields.apellido_paterno,
    apellido_materno: z.string().trim().max(120).nullable(),
    email: z.string().trim().email().max(254).nullable(),
    telefono: z.string().trim().max(40).nullable(),
    fecha_ingreso: isoDate("Fecha de ingreso (aaaa-mm-dd).").nullable(),
    area_id: uuid("Área.").nullable(),
    position_id: uuid("Puesto.").nullable(),
    manager_id: uuid("Jefe directo.").nullable(),
    site_id: uuid("Sucursal o corporativo.").nullable(),
    rfc: z.string().trim().max(13).nullable(),
    curp: z.string().trim().max(18).nullable(),
    nss: z.string().trim().max(11).nullable(),
    ...Object.fromEntries(
      Object.entries(mexicoWriteFields).map(([key, schema]) => [
        key,
        schema.nullable(),
      ]),
    ),
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Indica al menos un cambio.",
  )
  .describe(
    "Sólo los campos que cambian; null borra el dato. El estatus se cambia con set_person_status.",
  );

const FIELD_MAP: Record<string, keyof PersonFormValues> = {
  nombres: "nombres",
  apellido_paterno: "apellidoPaterno",
  apellido_materno: "apellidoMaterno",
  email: "email",
  telefono: "telefono",
  fecha_ingreso: "fechaIngreso",
  area_id: "areaId",
  position_id: "positionId",
  manager_id: "managerId",
  site_id: "siteId",
  rfc: "rfc",
  curp: "curp",
  nss: "nss",
  ...MEXICO_FIELD_MAP,
};

const changedFields = (changes: Record<string, unknown>) =>
  Object.keys(changes).map((field) => FIELD_MAP[field]);

const applyChanges = (
  person: PersonWithRelations,
  changes: Record<string, unknown>,
) => {
  const form = formFromPerson(person);

  for (const [field, value] of Object.entries(changes)) {
    const key = FIELD_MAP[field];
    (form as Record<string, unknown>)[key] =
      value ?? (key === "beneficiarios" ? [] : "");
  }

  return form;
};

export const updatePersonTool = defineWriteTool({
  name: "update_person",
  title: "Editar persona",
  description:
    "Edita sólo los campos enviados en changes (null borra el dato); el resto del expediente y el horario no cambian. No cambia el estatus (usa set_person_status). RFC, CURP y NSS sólo con el scope pii. Primero responde una vista previa con el antes y después; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({ person_id: uuid("Persona."), changes: changesSchema }),
  output: z.object({
    person: personRef,
    changes: z.record(
      z.string(),
      z.object({ from: z.unknown(), to: z.unknown() }),
    ),
  }),
  annotations: writeAnnotations("Editar persona"),
  preview: async ({ person_id, changes }, ctx) => {
    assertIdentifiersAllowed(ctx, changes as Record<string, unknown>);
    const person = await loadPerson(ctx, person_id);
    parseForm(applyChanges(person, changes), changedFields(changes));
    const hidden = new Set([
      "rfc",
      "curp",
      "nss",
      ...Object.keys(MEXICO_FIELD_MAP),
    ]);

    return {
      summary: `Editar a ${fullName(person)}: ${Object.keys(changes).join(", ")}.`,
      details: Object.fromEntries(
        Object.entries(changes).map(([field, value]) => [
          field,
          hidden.has(field) && !ctx.piiUnmasked ? "(dato protegido)" : value,
        ]),
      ),
    };
  },
  handler: async ({ person_id, changes }, ctx) => {
    assertIdentifiersAllowed(ctx, changes as Record<string, unknown>);
    const person = await loadPerson(ctx, person_id);
    const form = parseForm(
      applyChanges(person, changes),
      changedFields(changes),
    );
    const updated = await updatePerson(
      ctx.companyId,
      person.id,
      form,
      ctx.userId,
    );

    if (!updated) {
      throw notFound("La persona");
    }

    const before = formFromPerson(person) as Record<string, unknown>;
    const diff = Object.fromEntries(
      Object.keys(changes)
        .map((field) => [field, FIELD_MAP[field]] as const)
        .filter(
          ([, key]) =>
            (before[key] ?? "") !==
            ((form as Record<string, unknown>)[key] ?? ""),
        )
        .map(([field, key]) => [
          field,
          {
            from: before[key] || null,
            to: (form as Record<string, unknown>)[key] || null,
          },
        ]),
    );

    return { person: toRef(ctx, updated), changes: diff };
  },
});

const statusInput = z.object({
  person_id: uuid("Persona."),
  status: z.enum(["activa", "baja"]),
  // Baja: fecha, tipo, motivo and recontratable are required.
  fecha_baja: isoDate(
    "Baja: fecha de baja (aaaa-mm-dd), no antes del ingreso.",
  ).optional(),
  tipo_baja: z
    .enum(TERMINATION_TYPES)
    .optional()
    .describe("Baja: voluntaria, despido, termino_contrato u otra."),
  motivo_id: uuid("Baja: id del motivo (list_termination_reasons).").optional(),
  motivo: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      "Baja: nombre del motivo del catálogo, si no envías motivo_id. Un texto que no está en el catálogo es un error que lista los motivos.",
    ),
  comentario: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe("Baja: texto libre."),
  recontratable: z.boolean().optional().describe("Baja: obligatorio."),
  finiquito: z
    .object({
      estado: z.enum(FINIQUITO_STATUSES).optional(),
      fecha: isoDate("Fecha del finiquito.").optional(),
      monto: z
        .number()
        .min(0)
        .max(99_999_999.99)
        .optional()
        .describe("Pesos. Sólo con el scope pii y compensation:read."),
    })
    .optional()
    .describe(
      "Baja: finiquito opcional; se puede actualizar después en la app.",
    ),
  // Reingreso.
  fecha_ingreso: isoDate(
    "Reingreso: fecha de ingreso del nuevo periodo (aaaa-mm-dd); por defecto hoy.",
  ).optional(),
  reconocer_antiguedad: z
    .boolean()
    .default(false)
    .describe(
      "Reingreso: true acumula la antigüedad de los periodos anteriores; false (por defecto) la reinicia.",
    ),
  fecha_antiguedad_reconocida: isoDate(
    "Reingreso con reconocer_antiguedad: desde cuándo cuenta; vacío = el primer ingreso.",
  ).optional(),
});

type StatusArgs = z.infer<typeof statusInput>;

/** The baja or reingreso the call asks for, validated as the app's dialogs do. */
const resolveStatusChange = async (
  args: StatusArgs,
  ctx: WorkiaToolContext,
): Promise<{ change: PersonStatusChange; motivoName: string | null }> => {
  const issues = (list: { path: string; message: string }[]) =>
    new McpToolError("VALIDATION", "Faltan datos para el cambio de estatus.", {
      details: { issues: list },
    });

  if (args.status === "activa") {
    const parsed = rehireSchema.safeParse({
      fechaIngreso: args.fecha_ingreso ?? ctx.today,
      reconoceAntiguedad: args.reconocer_antiguedad,
      fechaAntiguedadReconocida: args.fecha_antiguedad_reconocida ?? null,
    });

    if (!parsed.success) {
      throw issues(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    return { change: { status: "activa", ...parsed.data }, motivoName: null };
  }

  if (args.finiquito?.monto !== undefined) {
    assertCompensationAccess(ctx, "el monto del finiquito");
  }

  const reasons = await listTerminationReasons(ctx.companyId, {
    activeOnly: true,
  });
  const reason = args.motivo_id
    ? reasons.find((item) => item.id === args.motivo_id)
    : args.motivo
      ? reasons.find(
          (item) => catalogKey(item.name) === catalogKey(args.motivo!),
        )
      : undefined;
  const missing = [
    !args.fecha_baja && {
      path: "fecha_baja",
      message: "Indica la fecha de baja.",
    },
    !args.tipo_baja && {
      path: "tipo_baja",
      message: "Indica el tipo de baja.",
    },
    !reason && {
      path: args.motivo_id ? "motivo_id" : "motivo",
      message: `Elige un motivo del catálogo: ${reasons.map((item) => item.name).join(", ")}.`,
    },
    args.recontratable === undefined && {
      path: "recontratable",
      message: "Indica si la persona es recontratable.",
    },
  ].filter((issue): issue is { path: string; message: string } =>
    Boolean(issue),
  );

  if (missing.length > 0) {
    throw issues(missing);
  }

  const parsed = terminationSchema.safeParse({
    fechaBaja: args.fecha_baja,
    tipoBaja: args.tipo_baja,
    motivoBajaId: reason!.id,
    comentario: args.comentario ?? null,
    recontratable: args.recontratable,
    finiquito: args.finiquito
      ? {
          estado: args.finiquito.estado ?? null,
          fecha: args.finiquito.fecha ?? null,
          ...(args.finiquito.monto === undefined
            ? {}
            : { monto: args.finiquito.monto }),
        }
      : undefined,
  });

  if (!parsed.success) {
    throw issues(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return {
    change: { status: "baja", ...parsed.data },
    motivoName: reason!.name,
  };
};

export const setPersonStatusTool = defineWriteTool({
  name: "set_person_status",
  title: "Baja o reingreso",
  description:
    "Da de baja laboral o reingresa a una persona (estatus activa | baja). No es borrar: el expediente sigue ahí. Baja: fecha_baja, tipo_baja, motivo (motivo_id de list_termination_reasons, o su nombre en motivo) y recontratable son obligatorios; comentario y finiquito opcionales (el monto sólo con el scope pii y compensation:read). Cierra el periodo laboral y el contrato vigente queda «terminado» en la fecha de baja. Reingreso (status activa): abre un nuevo periodo en el mismo expediente con fecha_ingreso (por defecto hoy) y reconocer_antiguedad (por defecto false: la antigüedad reinicia). La vista previa avisa si tiene contrato vigente, activos en resguardo o si su última baja dice no recontratable. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: statusInput,
  output: z.object({
    person: personRef,
    warnings: z.array(z.string()),
    contrato_terminado: z
      .string()
      .nullable()
      .describe("Id del contrato que quedó «terminado» con la baja."),
  }),
  annotations: writeAnnotations("Baja o reingreso", { destructive: true }),
  preview: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);

    if (person.status === args.status) {
      throw new McpToolError(
        "CONFLICT",
        `La persona ya está ${args.status === "baja" ? "dada de baja" : "activa"}.`,
      );
    }

    const { change, motivoName } = await resolveStatusChange(args, ctx);
    const warnings = await statusWarnings(ctx, person.id, args.status);

    return {
      summary:
        change.status === "baja"
          ? `Baja laboral de ${fullName(person)} el ${mx(change.fechaBaja)} · ${terminationTypeLabels[change.tipoBaja]} · Motivo: ${motivoName} · ${change.recontratable ? "recontratable" : "no recontratable"}.`
          : `Reingreso de ${fullName(person)} el ${mx(change.fechaIngreso)} · ${change.reconoceAntiguedad ? "reconoce la antigüedad previa" : "la antigüedad reinicia"}.`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
  handler: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);

    if (person.status === args.status) {
      throw new McpToolError(
        "CONFLICT",
        `La persona ya está ${args.status === "baja" ? "dada de baja" : "activa"}.`,
      );
    }

    const { change } = await resolveStatusChange(args, ctx);
    const warnings = await statusWarnings(ctx, person.id, args.status);
    const result = await setPersonStatus(
      ctx.companyId,
      person.id,
      change,
      ctx.userId,
    );

    if (!result) {
      throw notFound("La persona");
    }

    return {
      person: toRef(ctx, result.person),
      warnings,
      contrato_terminado:
        "contract" in result && result.contract ? result.contract.id : null,
    };
  },
});

const statusWarnings = async (
  ctx: WorkiaToolContext,
  personId: string,
  status: "activa" | "baja",
) => {
  if (status !== "baja") {
    const periods = await listEmploymentPeriods(ctx.companyId, personId);
    return rehireWarnings(periods.at(-1));
  }

  const [contract, assets] = await Promise.all([
    getVigenteContractForPerson(ctx.companyId, personId),
    listAssetsByPerson(ctx.companyId, personId),
  ]);

  return [
    contract
      ? `Tiene un contrato vigente${contract.endDate ? ` hasta el ${mx(contract.endDate)}` : ""}: quedará «Terminado» en la fecha de baja.`
      : null,
    assets.length > 0
      ? `Tiene ${assets.length} ${assets.length === 1 ? "activo" : "activos"} en resguardo: ${assets.map((asset) => asset.identifier).join(", ")}.`
      : null,
  ].filter((warning): warning is string => warning !== null);
};

export const updatePersonScheduleTool = defineWriteTool({
  name: "update_person_schedule",
  title: "Cambiar horario",
  description:
    "Obsoleta: usa update_person_schedule_blocks (horario por bloques, día de descanso). Captura un horario simple de lunes a viernes (HH:mm) y reemplaza los bloques. Los campos que no envíes quedan vacíos. No cambia contratos ya emitidos: conservan el horario con que se firmaron. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({
    person_id: uuid("Persona."),
    entrada: time("Entrada.").optional(),
    salida_comer: time("Salida a comer.").optional(),
    regreso_comer: time("Regreso de comer.").optional(),
    salida: time("Salida.").optional(),
  }),
  output: z.object({
    person: personRef,
    horario: z.object({
      entrada: z.string().nullable(),
      salida_comer: z.string().nullable(),
      regreso_comer: z.string().nullable(),
      salida: z.string().nullable(),
    }),
    note: z.string(),
  }),
  annotations: writeAnnotations("Cambiar horario"),
  preview: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);
    const next = {
      entrada: args.entrada ?? null,
      salidaComer: args.salida_comer ?? null,
      regresoComer: args.regreso_comer ?? null,
      salida: args.salida ?? null,
    };

    return {
      summary: `Horario de ${fullName(person)}: ${formatHorarioToken(person.schedule)} → ${formatHorarioToken(next)}.`,
      warnings: [
        "Aplica a contratos nuevos; los emitidos conservan su horario.",
      ],
    };
  },
  handler: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);
    const form = parseForm(
      {
        ...formFromPerson(person),
        horarioEntrada: args.entrada ?? "",
        horarioSalidaComer: args.salida_comer ?? "",
        horarioRegresoComer: args.regreso_comer ?? "",
        horarioSalida: args.salida ?? "",
      },
      [
        "horarioEntrada",
        "horarioSalidaComer",
        "horarioRegresoComer",
        "horarioSalida",
      ],
    );

    await upsertPersonSchedule(ctx.companyId, person.id, form, ctx.userId);

    return {
      person: toRef(ctx, person),
      horario: {
        entrada: args.entrada ?? null,
        salida_comer: args.salida_comer ?? null,
        regreso_comer: args.regreso_comer ?? null,
        salida: args.salida ?? null,
      },
      note: "Aplica a contratos nuevos; los emitidos conservan su horario.",
    };
  },
});

export const updatePersonScheduleBlocksTool = defineWriteTool({
  name: "update_person_schedule_blocks",
  title: "Cambiar horario por bloques",
  description:
    "Captura el horario por bloques de una persona: cada bloque con días (lun…dom), entrada, salida y comida opcional, más el día de descanso. Reemplaza el horario completo (lista vacía lo borra). La vista previa muestra el texto, p. ej. «L–V 08:00–17:00 (comida 13:00–14:00) · Sáb 08:00–13:00 · Descanso dom». No cambia contratos ya emitidos. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({
    person_id: uuid("Persona."),
    bloques: bloquesInput,
    dia_descanso: diaDescansoInput,
  }),
  output: z.object({
    person: personRef,
    horario_bloques: horarioBloquesSchema,
    note: z.string(),
  }),
  annotations: writeAnnotations("Cambiar horario por bloques"),
  preview: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);
    const next = toScheduleBlocks(args.bloques, args.dia_descanso);
    const current = horarioBloques(person.schedule);

    return {
      summary: `Horario de ${fullName(person)}: ${current?.texto ?? "—"} → ${horarioBloques({ blocks: next.bloques, restDay: next.diaDescanso })?.texto ?? "sin horario"}.`,
      warnings: [
        "Aplica a contratos nuevos; los emitidos conservan su horario.",
      ],
    };
  },
  handler: async (args, ctx) => {
    const person = await loadPerson(ctx, args.person_id);
    const next = toScheduleBlocks(args.bloques, args.dia_descanso);
    const form = parseForm(
      { ...formFromPerson(person), horarioBloques: next },
      ["horarioBloques"],
    );

    await upsertPersonSchedule(ctx.companyId, person.id, form, ctx.userId);

    return {
      person: toRef(ctx, person),
      horario_bloques:
        next.bloques.length > 0
          ? horarioBloques({ blocks: next.bloques, restDay: next.diaDescanso })
          : null,
      note: "Aplica a contratos nuevos; los emitidos conservan su horario.",
    };
  },
});
