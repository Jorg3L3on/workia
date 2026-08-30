import { z } from "zod";

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

const optionalIdentifier = z
  .string()
  .trim()
  .max(32)
  .optional()
  .or(z.literal(""));

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
  rfc: optionalIdentifier,
  curp: optionalIdentifier,
  nss: optionalIdentifier,
  status: z.enum(PERSON_STATUSES),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

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

export const formatDateLabel = (value?: string | Date | null) => {
  if (!value) {
    return "—";
  }

  const date =
    typeof value === "string" ? new Date(`${value}T12:00:00`) : value;

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};
