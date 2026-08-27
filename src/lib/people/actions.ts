"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/rbac";

import { createPerson, getPersonById, updatePerson } from "./index";
import {
  requirePeopleCreate,
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
  givenName: String(formData.get("givenName") ?? ""),
  familyName: String(formData.get("familyName") ?? ""),
  email: String(formData.get("email") ?? ""),
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

export const createPersonAction = async (
  _prevState: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> => {
  try {
    await requirePeopleCreate();
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

  const created = await createPerson(parsed);

  revalidatePath("/app/personas");
  revalidatePath("/app");
  redirect(`/app/personas/${created.id}`);
};

export const updatePersonAction = async (
  personId: string,
  _prevState: PersonActionState,
  formData: FormData,
): Promise<PersonActionState> => {
  try {
    await requirePeopleUpdate();
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

  await updatePerson(personId, parsed);

  revalidatePath("/app/personas");
  revalidatePath(`/app/personas/${personId}`);
  revalidatePath("/app");
  redirect(`/app/personas/${personId}?saved=1`);
};

export const assertPeopleListAccess = async () => requirePeopleRead();
