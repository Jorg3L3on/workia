"use server";

import { z } from "zod";

import { requirePeopleRead } from "../auth";
import {
  createPeopleView,
  deletePeopleView,
  MAX_PEOPLE_VIEW_NAME,
  PeopleViewLimitError,
  updatePeopleView,
  type PeopleViewSummary,
} from "./index";

export type PeopleViewActionResult =
  { ok: true; view: PeopleViewSummary } | { ok: false; error: string };

const inputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Escribe un nombre para la vista.")
    .max(MAX_PEOPLE_VIEW_NAME, "El nombre es demasiado largo."),
  shared: z.boolean(),
  // Validated (and cleaned) by the views module, as when read.
  filter: z.unknown(),
  columns: z.unknown(),
});

const NOT_ALLOWED = "No tienes permiso para guardar vistas de Personas.";
const NOT_FOUND = "La vista ya no existe o no es tuya.";

/** A saved view needs people:read: it only stores how the list is read. */
const actor = async () => {
  try {
    const session = await requirePeopleRead();
    return {
      companyId: session.companyId,
      actor: { userId: session.user.id, permissions: session.permissions },
    };
  } catch {
    return null;
  }
};

export const createPeopleViewAction = async (
  input: unknown,
): Promise<PeopleViewActionResult> => {
  const current = await actor();

  if (!current) return { ok: false, error: NOT_ALLOWED };

  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  try {
    const view = await createPeopleView(current.companyId, current.actor, {
      ...parsed.data,
    });
    return view ? { ok: true, view } : { ok: false, error: NOT_FOUND };
  } catch (error) {
    if (error instanceof PeopleViewLimitError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
};

/** Only the owner can change a view (name, filter, columns, sharing). */
export const updatePeopleViewAction = async (
  viewId: string,
  input: unknown,
): Promise<PeopleViewActionResult> => {
  const current = await actor();

  if (!current) return { ok: false, error: NOT_ALLOWED };

  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  if (!z.uuid().safeParse(viewId).success) {
    return { ok: false, error: NOT_FOUND };
  }

  const view = await updatePeopleView(
    current.companyId,
    current.actor,
    viewId,
    { ...parsed.data },
  );

  return view ? { ok: true, view } : { ok: false, error: NOT_FOUND };
};

export const deletePeopleViewAction = async (
  viewId: string,
): Promise<{ ok: boolean; error?: string }> => {
  const current = await actor();

  if (!current) return { ok: false, error: NOT_ALLOWED };

  if (!z.uuid().safeParse(viewId).success) {
    return { ok: false, error: NOT_FOUND };
  }

  const deleted = await deletePeopleView(
    current.companyId,
    current.actor,
    viewId,
  );

  return deleted ? { ok: true } : { ok: false, error: NOT_FOUND };
};
