import { z } from "zod";

import { getVigenteContractForPerson } from "@/lib/contracts";
import {
  createPerson,
  getPersonWithRelations,
  updatePerson,
  upsertPersonSchedule,
  type PersonWithRelations as MaybePerson,
} from "@/lib/people";
import { listAssetsByPerson } from "@/lib/resguardo";
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

/** RFC, CURP and NSS are only written by a connection that may see them (pii). */
const assertIdentifiersAllowed = (
  ctx: WorkiaToolContext,
  values: { rfc?: string; curp?: string; nss?: string },
) => {
  if ((values.rfc || values.curp || values.nss) && !ctx.piiUnmasked) {
    throw new McpToolError(
      "FORBIDDEN_SCOPE",
      "Para capturar RFC, CURP o NSS la conexión necesita el scope pii.",
      { details: { required_scope: "pii" } },
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
};

const createInput = z.object(personFields);

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
};

const changedFields = (changes: Record<string, unknown>) =>
  Object.keys(changes).map((field) => FIELD_MAP[field]);

const applyChanges = (
  person: PersonWithRelations,
  changes: Record<string, string | null>,
) => {
  const form = formFromPerson(person);

  for (const [field, value] of Object.entries(changes)) {
    (form as Record<string, unknown>)[FIELD_MAP[field]] = value ?? "";
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
    assertIdentifiersAllowed(ctx, {
      rfc: changes.rfc ?? undefined,
      curp: changes.curp ?? undefined,
      nss: changes.nss ?? undefined,
    });
    const person = await loadPerson(ctx, person_id);
    parseForm(applyChanges(person, changes), changedFields(changes));
    const hidden = new Set(["rfc", "curp", "nss"]);

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
    assertIdentifiersAllowed(ctx, {
      rfc: changes.rfc ?? undefined,
      curp: changes.curp ?? undefined,
      nss: changes.nss ?? undefined,
    });
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

export const setPersonStatusTool = defineWriteTool({
  name: "set_person_status",
  title: "Baja o reactivación",
  description:
    "Da de baja laboral o reactiva a una persona (estatus activa | baja). No es borrar: el expediente sigue ahí. La vista previa avisa si tiene contrato vigente o activos en resguardo. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
  scope: "write:people",
  permission: "people:update",
  input: z.object({
    person_id: uuid("Persona."),
    status: z.enum(["activa", "baja"]),
    motivo: z.string().trim().max(300).optional(),
  }),
  output: z.object({ person: personRef, warnings: z.array(z.string()) }),
  annotations: writeAnnotations("Baja o reactivación", { destructive: true }),
  preview: async ({ person_id, status, motivo }, ctx) => {
    const person = await loadPerson(ctx, person_id);

    if (person.status === status) {
      throw new McpToolError(
        "CONFLICT",
        `La persona ya está ${status === "baja" ? "dada de baja" : "activa"}.`,
      );
    }

    const warnings = await statusWarnings(ctx, person.id, status);

    return {
      summary: `${status === "baja" ? "Baja laboral" : "Reactivación"} de ${fullName(person)}${motivo ? ` · Motivo: ${motivo}` : ""}.`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
  handler: async ({ person_id, status }, ctx) => {
    const person = await loadPerson(ctx, person_id);

    if (person.status === status) {
      throw new McpToolError(
        "CONFLICT",
        `La persona ya está ${status === "baja" ? "dada de baja" : "activa"}.`,
      );
    }

    const warnings = await statusWarnings(ctx, person.id, status);
    const updated = await updatePerson(
      ctx.companyId,
      person.id,
      parseForm({ ...formFromPerson(person), status }, ["status"]),
      ctx.userId,
    );

    if (!updated) {
      throw notFound("La persona");
    }

    return { person: toRef(ctx, updated), warnings };
  },
});

const statusWarnings = async (
  ctx: WorkiaToolContext,
  personId: string,
  status: "activa" | "baja",
) => {
  if (status !== "baja") {
    return [];
  }

  const [contract, assets] = await Promise.all([
    getVigenteContractForPerson(ctx.companyId, personId),
    listAssetsByPerson(ctx.companyId, personId),
  ]);

  return [
    contract
      ? `Tiene un contrato vigente${contract.endDate ? ` hasta el ${mx(contract.endDate)}` : ""}.`
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
    "Captura o cambia el horario de una persona (HH:mm). Los campos que no envíes quedan vacíos. No cambia contratos ya emitidos: conservan el horario con que se firmaron. Primero responde una vista previa; repite con confirmation_token para hacerlo.",
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
