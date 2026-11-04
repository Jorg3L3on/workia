"use server";

import { revalidatePath } from "next/cache";

import { requireEmployeeContext } from "@/lib/employee-accounts/session";

import { saveEmployeeIntake } from "./intake";
import {
  INTAKE_BENEFICIARY_SLOTS,
  INTAKE_COPY,
  INTAKE_FIELD_KEYS,
} from "./intake-schema";

export type EmployeeIntakeState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string>;
  /** What the person typed, so the form shows it again after a refused save. */
  values?: IntakeEcho;
};

export type IntakeEcho = Record<string, unknown> & {
  beneficiarios?: { nombre: string; parentesco: string; porcentaje: string }[];
};

/** The form's values: empty fields are left out, so a draft keeps only what was typed. */
const valuesFromForm = (formData: FormData) => {
  const values: IntakeEcho = {};

  for (const key of INTAKE_FIELD_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") values[key] = value;
  }

  const beneficiaries = [];
  for (let slot = 0; slot < INTAKE_BENEFICIARY_SLOTS; slot += 1) {
    const read = (name: string) =>
      String(formData.get(`beneficiario_${slot}_${name}`) ?? "").trim();
    const entry = {
      nombre: read("nombre"),
      parentesco: read("parentesco"),
      porcentaje: read("porcentaje"),
    };
    if (entry.nombre || entry.parentesco || entry.porcentaje) {
      beneficiaries.push(entry);
    }
  }
  if (beneficiaries.length > 0) values.beneficiarios = beneficiaries;

  return values;
};

/**
 * «Guardar» or «Enviar a RH» from /mi/alta (W2-10). The person comes from
 * the session; the form never names one.
 */
export const saveEmployeeIntakeAction = async (
  _state: EmployeeIntakeState,
  formData: FormData,
): Promise<EmployeeIntakeState> => {
  const context = await requireEmployeeContext();
  const submit = formData.get("intencion") === "enviar";
  const values = valuesFromForm(formData);
  const result = await saveEmployeeIntake(context, values, { submit });

  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors, values };
  }

  revalidatePath("/mi", "layout");
  return { notice: submit ? INTAKE_COPY.sent : INTAKE_COPY.saved };
};
