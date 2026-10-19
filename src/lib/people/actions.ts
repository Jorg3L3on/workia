"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CompanyReferenceError } from "@/lib/db/errors";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { DuplicateIdentityError } from "./identity";
import {
  createPerson,
  getPersonById,
  searchActivePeopleForSelect,
  setPersonStatus,
  softDeletePerson,
  updatePerson,
} from "./index";
import {
  requirePeopleCreate,
  requirePeopleDelete,
  requirePeopleRead,
  requirePeopleUpdate,
} from "./auth";
import {
  formatPersonName,
  personFormSchema,
  type PersonFormValues,
  type PersonStatusValue,
} from "./schema";

export type PersonActionState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof PersonFormValues, string>>;
};

const isPersonActionState = (
  value: PersonFormValues | PersonActionState,
): value is PersonActionState => "fieldErrors" in value || "error" in value;

const formDataToValues = (formData: FormData): PersonFormValues => ({
  nombres: String(formData.get("nombres") ?? ""),
  apellidoPaterno: String(formData.get("apellidoPaterno") ?? ""),
  apellidoMaterno: String(formData.get("apellidoMaterno") ?? ""),
  email: String(formData.get("email") ?? ""),
  telefono: String(formData.get("telefono") ?? ""),
  fechaNacimiento: String(formData.get("fechaNacimiento") ?? ""),
  fechaIngreso: String(formData.get("fechaIngreso") ?? ""),
  areaId: String(formData.get("areaId") ?? ""),
  positionId: String(formData.get("positionId") ?? ""),
  managerId: String(formData.get("managerId") ?? ""),
  siteId: String(formData.get("siteId") ?? ""),
  rfc: String(formData.get("rfc") ?? ""),
  curp: String(formData.get("curp") ?? ""),
  nss: String(formData.get("nss") ?? ""),
  horarioEntrada: String(formData.get("horarioEntrada") ?? ""),
  horarioSalidaComer: String(formData.get("horarioSalidaComer") ?? ""),
  horarioRegresoComer: String(formData.get("horarioRegresoComer") ?? ""),
  horarioSalida: String(formData.get("horarioSalida") ?? ""),
  status: String(
    formData.get("status") ?? "activa",
  ) as PersonFormValues["status"],
  ...mexicoValuesFromForm(formData),
  ...scheduleBlocksFromForm(formData),
});

/**
 * The schedule-by-blocks editor posts its value as JSON (WRK-I5-3). Absent
 * when the form did not render it: then the simple fields are the source.
 */
const scheduleBlocksFromForm = (
  formData: FormData,
): Pick<PersonFormValues, "horarioBloques"> => {
  const raw = formData.get("horarioBloques");

  if (raw === null) {
    return {};
  }

  try {
    return { horarioBloques: JSON.parse(String(raw)) };
  } catch {
    // Fails validation with the schema's message.
    return { horarioBloques: { bloques: "inválido" } as never };
  }
};

const MEXICO_TEXT_FIELDS = [
  "domicilioCalle",
  "domicilioNumeroExterior",
  "domicilioNumeroInterior",
  "domicilioColonia",
  "domicilioMunicipio",
  "domicilioEstado",
  "domicilioCodigoPostal",
  "estadoCivil",
  "sexo",
  "lugarNacimiento",
  "nacionalidad",
  "ineClaveElector",
] as const;

/**
 * Expediente México fields of the form. A field the form did not render stays
 * undefined (kept as stored); beneficiaries come as parallel lists and are only
 * read when the form says it rendered the editor.
 */
const mexicoValuesFromForm = (formData: FormData) => {
  const values: Partial<PersonFormValues> = {};

  for (const field of MEXICO_TEXT_FIELDS) {
    const value = formData.get(field);
    if (value !== null) {
      (values as Record<string, unknown>)[field] = String(value);
    }
  }

  if (formData.get("beneficiariosEditor") === "1") {
    const nombres = formData.getAll("beneficiarioNombre").map(String);
    const parentescos = formData.getAll("beneficiarioParentesco").map(String);
    const porcentajes = formData.getAll("beneficiarioPorcentaje").map(String);

    values.beneficiarios = nombres
      .map((nombre, index) => ({
        nombre,
        parentesco: parentescos[index] ?? "",
        porcentaje: Number(porcentajes[index] ?? 0),
      }))
      .filter(
        (row) => row.nombre.trim() || row.parentesco.trim() || row.porcentaje,
      );
  }

  return values;
};

const parsePersonForm = (
  formData: FormData,
): PersonActionState | PersonFormValues => {
  const parsed = personFormSchema.safeParse(formDataToValues(formData));

  if (!parsed.success) {
    const fieldErrors: PersonActionState["fieldErrors"] = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path[0];

      if (
        typeof field === "string" &&
        !fieldErrors[field as keyof PersonFormValues]
      ) {
        fieldErrors[field as keyof PersonFormValues] = issue.message;
      }
    }

    return { fieldErrors };
  }

  return parsed.data;
};

const duplicateIdentityState = (
  error: DuplicateIdentityError,
): PersonActionState => ({
  fieldErrors: Object.fromEntries(
    error.fields.map((field) => [
      field,
      field === "curp"
        ? "Ya existe una persona activa con esta CURP"
        : field === "rfc"
          ? "Ya existe una persona activa con este RFC"
          : "Ya existe una persona activa con este NSS",
    ]),
  ),
});

const referenceState = (error: CompanyReferenceError): PersonActionState => ({
  fieldErrors: {
    [error.field as keyof PersonFormValues]:
      "Elige una opción de la lista; esa ya no existe en esta empresa.",
  },
});

const revalidatePersonPaths = (personId?: string) => {
  revalidatePath("/app/personas");
  revalidatePath("/app");
  revalidatePath("/app/auditoria");

  if (personId) {
    revalidatePath(`/app/personas/${personId}`);
  }
};

export const createPersonAction = async (
  _prevState: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> => {
  let session;

  try {
    session = await requirePeopleCreate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para dar de alta personas." };
    }

    return { error: "Sesión no válida." };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const parsed = parsePersonForm(formData);

  if (isPersonActionState(parsed)) {
    return parsed;
  }

  let created;

  try {
    created = await createPerson(companyId, parsed, session.user.id);
  } catch (error) {
    if (error instanceof DuplicateIdentityError) {
      return duplicateIdentityState(error);
    }

    if (error instanceof CompanyReferenceError) {
      return referenceState(error);
    }

    throw error;
  }

  revalidatePersonPaths(created.id);
  redirect(`/app/personas/${created.id}`);
};

export const updatePersonAction = async (
  personId: string,
  _prevState: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> => {
  let session;

  try {
    session = await requirePeopleUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "No tienes permiso para editar personas." };
    }

    return { error: "Sesión no válida." };
  }

  let companyId: string;

  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const existing = await getPersonById(companyId, personId);

  if (!existing) {
    return { error: "No encontramos a esta persona." };
  }

  const parsed = parsePersonForm(formData);

  if (isPersonActionState(parsed)) {
    return parsed;
  }

  try {
    // The form never changes the status: baja and reactivation are their own action.
    await updatePerson(
      companyId,
      personId,
      { ...parsed, status: existing.status },
      session.user.id,
    );
  } catch (error) {
    if (error instanceof DuplicateIdentityError) {
      return duplicateIdentityState(error);
    }

    if (error instanceof CompanyReferenceError) {
      return referenceState(error);
    }

    throw error;
  }

  revalidatePersonPaths(personId);
  redirect(`/app/personas/${personId}?saved=1`);
};

/** «Dar de baja» / «Reactivar» from the expediente's actions menu. */
export const setPersonStatusAction = async (
  personId: string,
  status: PersonStatusValue,
): Promise<void> => {
  let session;

  try {
    session = await requirePeopleUpdate();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(`/app/personas/${personId}?error=status-forbidden`);
    }

    redirect("/login");
  }

  const updated = await setPersonStatus(
    session.companyId,
    personId,
    status,
    session.user.id,
  );

  if (!updated) {
    redirect("/app/personas?error=not-found");
  }

  revalidatePersonPaths(personId);
  redirect(`/app/personas/${personId}`);
};

export const deletePersonAction = async (personId: string): Promise<void> => {
  let session;

  try {
    session = await requirePeopleDelete();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(`/app/personas/${personId}?error=delete-forbidden`);
    }

    redirect("/login");
  }

  const existing = await getPersonById(session.companyId, personId);

  if (!existing) {
    redirect("/app/personas?error=not-found");
  }

  await softDeletePerson(session.companyId, personId, session.user.id);

  revalidatePersonPaths(personId);
  redirect(`/app/personas/${personId}`);
};

export const assertPeopleListAccess = async () => requirePeopleRead();

export type ManagerOption = { id: string; label: string };

/** Server action behind the manager picker: needs people:update, or create for new records. */
export const searchManagerOptionsAction = async (
  query: string,
  excludeId?: string,
): Promise<ManagerOption[]> => {
  let session;

  try {
    session = await requirePeopleRead();
  } catch {
    return [];
  }

  const rows = await searchActivePeopleForSelect(
    session.companyId,
    query.slice(0, 80),
    excludeId || undefined,
  );

  return rows.map((row) => ({ id: row.id, label: formatPersonName(row) }));
};
