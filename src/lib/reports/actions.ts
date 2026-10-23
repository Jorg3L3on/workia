"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { requireReportsSettings } from "./auth";
import { setTurnoverGoal } from "./turnover/data";

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
