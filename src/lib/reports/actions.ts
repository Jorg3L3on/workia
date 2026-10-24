"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isoToday } from "@/lib/format/date";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { requireReportsRead, requireReportsSettings } from "./auth";
import { setTurnoverGoal } from "./turnover/data";
import { turnoverFilterSchema } from "./turnover/schema";
import {
  createTurnoverView,
  deleteTurnoverView,
  MAX_TURNOVER_VIEW_NAME,
  TurnoverViewLimitError,
} from "./turnover/views";

export type TurnoverGoalActionResult =
  { ok: true; goal: number | null } | { ok: false; error: string };

const goalSchema = z.object({
  companyId: z.uuid(),
  goal: z
    .number({ error: "Escribe la meta como porcentaje." })
    .gt(0, "La meta debe ser mayor que 0 %.")
    .lte(100, "La meta no puede pasar de 100 %.")
    .nullable(),
});

/**
 * Sets the company's monthly turnover goal, or clears it with null
 * (settings:update). The companyId the dashboard was opened with must still
 * be the session's: a goal never lands on another company.
 */
export const setTurnoverGoalAction = async (
  input: unknown,
): Promise<TurnoverGoalActionResult> => {
  let session;

  try {
    session = await requireReportsSettings();
  } catch {
    return {
      ok: false,
      error: "No tienes permiso para cambiar la meta de rotación.",
    };
  }

  const parsed = goalSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  if (parsed.data.companyId !== session.companyId) {
    return { ok: false, error: STALE_COMPANY_MESSAGE };
  }

  const goal =
    parsed.data.goal === null ? null : Math.round(parsed.data.goal * 100) / 100;

  await setTurnoverGoal(session.companyId, goal, session.user.id);
  revalidatePath("/app/reportes/rotacion");

  return { ok: true, goal };
};

export type TurnoverViewActionResult =
  { ok: true; id: string } | { ok: false; error: string };

const viewSchema = z.object({
  companyId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Escribe un nombre para la vista.")
    .max(MAX_TURNOVER_VIEW_NAME, "El nombre es demasiado largo."),
  shared: z.boolean(),
  filter: turnoverFilterSchema,
});

const NO_REPORTS = "No tienes permiso para guardar vistas del reporte.";

/** Saves the report's current filter as a view (reports:read). */
export const createTurnoverViewAction = async (
  input: unknown,
): Promise<TurnoverViewActionResult> => {
  let session;

  try {
    session = await requireReportsRead();
  } catch {
    return { ok: false, error: NO_REPORTS };
  }

  const parsed = viewSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  if (parsed.data.companyId !== session.companyId) {
    return { ok: false, error: STALE_COMPANY_MESSAGE };
  }

  try {
    const view = await createTurnoverView(
      session.companyId,
      session.user.id,
      parsed.data,
      isoToday(),
    );
    revalidatePath("/app/reportes/rotacion");

    return { ok: true, id: view.id };
  } catch (error) {
    if (error instanceof TurnoverViewLimitError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
};

/** Deletes one of the user's own views of the report. */
export const deleteTurnoverViewAction = async (
  viewId: string,
): Promise<{ ok: boolean; error?: string }> => {
  let session;

  try {
    session = await requireReportsRead();
  } catch {
    return { ok: false, error: NO_REPORTS };
  }

  if (!z.uuid().safeParse(viewId).success) {
    return { ok: false, error: "La vista ya no existe o no es tuya." };
  }

  const deleted = await deleteTurnoverView(
    session.companyId,
    session.user.id,
    viewId,
  );
  revalidatePath("/app/reportes/rotacion");

  return deleted
    ? { ok: true }
    : { ok: false, error: "La vista ya no existe o no es tuya." };
};
