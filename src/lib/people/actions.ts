"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/rbac";

import {
  createPerson,
  getPersonById,
  softDeletePerson,
  updatePerson,
} from "./index";
import {
  requirePeopleCreate,
  requirePeopleDelete,
  requirePeopleRead,
  requirePeopleUpdate,
} from "./auth";
import { personFormSchema, type PersonFormValues } from "./schema";

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
  status: String(
    formData.get("status") ?? "activa",
  ) as PersonFormValues["status"],
});

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

  const parsed = parsePersonForm(formData);

  if (isPersonActionState(parsed)) {
    return parsed;
  }

  const created = await createPerson(parsed, session.user.id);

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

  const existing = await getPersonById(personId);

  if (!existing) {
    return { error: "No encontramos a esta persona." };
  }

  const parsed = parsePersonForm(formData);

  if (isPersonActionState(parsed)) {
    return parsed;
  }

  await updatePerson(personId, parsed, session.user.id);

  revalidatePersonPaths(personId);
  redirect(`/app/personas/${personId}?saved=1`);
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

  const existing = await getPersonById(personId);

  if (!existing) {
    redirect("/app/personas?error=not-found");
  }

  await softDeletePerson(personId, session.user.id);

  revalidatePersonPaths();
  redirect("/app/personas");
};

export const assertPeopleListAccess = async () => requirePeopleRead();
