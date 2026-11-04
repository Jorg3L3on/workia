"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { alertAbsences } from "@/lib/lft-alerts";
import { requirePayPeriodsManage } from "@/lib/pay-periods/auth";
import type { PayPeriodActionState } from "@/lib/pay-periods/copy";
import { isQuincena, PayPeriodError } from "@/lib/pay-periods/quincena";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";
import type { IncidenciaKind } from "@/lib/timeline/events";

import { INCIDENCIAS_COPY } from "./copy";
import {
  cancelJustification,
  createJustification,
  IncidenciaError,
  overrideIncidencia,
  runIncidencias,
  saveIncidenciaRules,
  type JustificationInput,
} from "./index";

/**
 * HR's incidencias actions (Workia 2.0 W2-14): the rules, permisos and
 * incapacidades, overrides of one incidencia, and a recompute of a quincena.
 * All need pay_periods:manage; the work and its audit event are in
 * src/lib/incidencias.
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const manage = async (formData: FormData) => {
  let session;

  try {
    session = await requirePayPeriodsManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: INCIDENCIAS_COPY.denied };
    }

    redirect("/login");
  }

  try {
    return {
      companyId: writableCompanyIdFromForm(session, formData),
      actorUserId: session.user.id,
    };
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }
};

const failure = (error: unknown): PayPeriodActionState => {
  if (error instanceof PayPeriodError || error instanceof IncidenciaError) {
    return { error: error.message };
  }

  throw error;
};

const revalidatePeriods = () => {
  revalidatePath("/app/periodos", "layout");
  revalidatePath("/app/auditoria");
};

const minutes = (formData: FormData, key: string) => {
  const raw = text(formData, key);

  return raw === "" ? null : Number(raw);
};

export const saveIncidenciaRulesAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manage(formData);

  if ("error" in auth) return { error: auth.error };

  const retardo = minutes(formData, "retardoToleranceMinutes");
  const salida = minutes(formData, "salidaToleranceMinutes");

  try {
    const saved = await saveIncidenciaRules(
      auth.companyId,
      {
        retardoToleranceMinutes: retardo ?? Number.NaN,
        salidaToleranceMinutes: salida ?? Number.NaN,
        faltaAfterMinutes: minutes(formData, "faltaAfterMinutes"),
      },
      { actorUserId: auth.actorUserId },
    );

    revalidatePeriods();

    return {
      ok: true,
      message: INCIDENCIAS_COPY.rulesSaved(saved.effectivePeriod),
    };
  } catch (error) {
    return failure(error);
  }
};

export const recomputePayPeriodAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manage(formData);

  if ("error" in auth) return { error: auth.error };

  const period = text(formData, "period");

  if (!isQuincena(period)) return { error: INCIDENCIAS_COPY.invalidPeriod };

  try {
    const result = await runIncidencias(auth.companyId, period);
    // The recomputed faltas may reach an LFT threshold (W2-19).
    await alertAbsences(auth.companyId);

    revalidatePeriods();

    return {
      ok: true,
      message: INCIDENCIAS_COPY.recomputed(result.incidencias),
    };
  } catch (error) {
    return failure(error);
  }
};

const JUSTIFICATION_KINDS = new Set([
  "permiso_con_goce",
  "permiso_sin_goce",
  "incapacidad_imss",
]);

export const createJustificationAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manage(formData);

  if ("error" in auth) return { error: auth.error };

  const kind = text(formData, "kind");

  if (!JUSTIFICATION_KINDS.has(kind)) {
    return { error: INCIDENCIAS_COPY.invalidKind };
  }

  try {
    await createJustification(
      auth.companyId,
      {
        personId: text(formData, "personId"),
        kind: kind as JustificationInput["kind"],
        fromDay: text(formData, "fromDay"),
        toDay: text(formData, "toDay") || text(formData, "fromDay"),
        reason: text(formData, "reason"),
        reference: text(formData, "reference") || null,
      },
      { actorUserId: auth.actorUserId },
    );

    revalidatePeriods();

    return { ok: true, message: INCIDENCIAS_COPY.justificationSaved };
  } catch (error) {
    return failure(error);
  }
};

const INCIDENCIA_KINDS = new Set(["falta", "retardo", "salida_anticipada"]);

export const overrideIncidenciaAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manage(formData);

  if ("error" in auth) return { error: auth.error };

  const kind = text(formData, "kind");
  const effect = text(formData, "effect");

  if (
    !INCIDENCIA_KINDS.has(kind) ||
    (effect !== "justify" && effect !== "void")
  ) {
    return { error: INCIDENCIAS_COPY.invalidKind };
  }

  try {
    await overrideIncidencia(
      auth.companyId,
      {
        personId: text(formData, "personId"),
        day: text(formData, "day"),
        kind: kind as IncidenciaKind,
        effect,
        reason: text(formData, "reason"),
      },
      { actorUserId: auth.actorUserId },
    );

    revalidatePeriods();

    return {
      ok: true,
      message:
        effect === "void"
          ? INCIDENCIAS_COPY.voided
          : INCIDENCIAS_COPY.justified,
    };
  } catch (error) {
    return failure(error);
  }
};

export const cancelJustificationAction = async (
  _state: PayPeriodActionState,
  formData: FormData,
): Promise<PayPeriodActionState> => {
  const auth = await manage(formData);

  if ("error" in auth) return { error: auth.error };

  try {
    await cancelJustification(auth.companyId, text(formData, "id"), {
      reason: text(formData, "reason"),
      actorUserId: auth.actorUserId,
    });

    revalidatePeriods();

    return { ok: true, message: INCIDENCIAS_COPY.cancelled };
  } catch (error) {
    return failure(error);
  }
};
