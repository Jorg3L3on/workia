"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveEmployeeIntakeAction,
  type EmployeeIntakeState,
} from "@/lib/onboarding/employee-actions";
import {
  INTAKE_BENEFICIARY_SLOTS,
  INTAKE_FIELDS,
  INTAKE_SECTIONS,
  intakeSectionLabels,
  type IntakeData,
} from "@/lib/onboarding/intake-schema";
import { cn } from "@/lib/utils";

const selectClassName =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 h-11 w-full min-w-0 rounded-lg border bg-transparent px-2.5 text-base outline-none focus-visible:ring-3 aria-invalid:ring-3 disabled:opacity-50";

/**
 * «Completa tu alta» (W2-10): the new hire's personal, address and
 * beneficiary fields, phone first. «Guardar» keeps a draft; «Enviar a RH»
 * needs the required fields and locks the form until HR decides.
 */
export const IntakeForm = ({
  values,
  editable,
}: {
  values: Partial<IntakeData>;
  editable: boolean;
}) => {
  const [state, action, pending] = useActionState<
    EmployeeIntakeState,
    FormData
  >(saveEmployeeIntakeAction, {});
  const errors = state.fieldErrors ?? {};
  // After a refused save, show what was typed (React resets the form).
  const shown: Record<string, unknown> = state.values ?? values;
  const beneficiaries = (shown.beneficiarios ?? []) as {
    nombre: string;
    parentesco: string;
    porcentaje: string | number;
  }[];

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {INTAKE_SECTIONS.filter((section) => section !== "beneficiarios").map(
        (section) => (
          <fieldset
            className="workia-pass-card flex flex-col gap-4 px-5 py-4"
            disabled={!editable || pending}
            key={section}
          >
            <legend className="sr-only">{intakeSectionLabels[section]}</legend>
            <h2 aria-hidden className="text-base font-semibold">
              {intakeSectionLabels[section]}
            </h2>
            {INTAKE_FIELDS.filter((field) => field.section === section).map(
              (field) => {
                const id = `intake-${field.key}`;
                const error = errors[field.key];
                const current = shown[field.key] ?? "";
                const hint = "hint" in field ? field.hint : undefined;

                return (
                  <div className="space-y-1.5" key={field.key}>
                    <Label htmlFor={id}>
                      {field.label}
                      {field.required ? null : (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          (opcional)
                        </span>
                      )}
                    </Label>
                    {field.kind === "select" ? (
                      <select
                        aria-invalid={Boolean(error) || undefined}
                        className={selectClassName}
                        defaultValue={String(current)}
                        id={id}
                        name={field.key}
                      >
                        <option value="">Elige una opción</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        aria-describedby={hint ? `${id}-hint` : undefined}
                        aria-invalid={Boolean(error) || undefined}
                        autoCapitalize={
                          field.key === "rfc" || field.key === "ineClaveElector"
                            ? "characters"
                            : undefined
                        }
                        autoComplete={
                          "autoComplete" in field ? field.autoComplete : "off"
                        }
                        className={cn(
                          "h-11",
                          (field.key === "rfc" ||
                            field.key === "ineClaveElector") &&
                            "uppercase",
                        )}
                        defaultValue={String(current)}
                        id={id}
                        inputMode={
                          "inputMode" in field ? field.inputMode : undefined
                        }
                        maxLength={
                          "maxLength" in field ? field.maxLength : undefined
                        }
                        name={field.key}
                        type={field.kind}
                      />
                    )}
                    {hint ? (
                      <p
                        className="text-muted-foreground text-xs"
                        id={`${id}-hint`}
                      >
                        {hint}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="text-destructive text-sm" role="alert">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              },
            )}
          </fieldset>
        ),
      )}

      <fieldset
        className="workia-pass-card flex flex-col gap-4 px-5 py-4"
        disabled={!editable || pending}
      >
        <legend className="sr-only">{intakeSectionLabels.beneficiarios}</legend>
        <div className="space-y-1">
          <h2 aria-hidden className="text-base font-semibold">
            {intakeSectionLabels.beneficiarios}{" "}
            <span className="text-muted-foreground text-sm font-normal">
              (opcional)
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">
            Hasta {INTAKE_BENEFICIARY_SLOTS} personas. Los porcentajes suman
            100.
          </p>
        </div>
        {Array.from({ length: INTAKE_BENEFICIARY_SLOTS }, (_, slot) => {
          const current = beneficiaries[slot];
          return (
            <div
              className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[2fr_1fr_6rem]"
              key={slot}
            >
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor={`beneficiario-${slot}-nombre`}>
                  Nombre {slot + 1}
                </Label>
                <Input
                  className="h-11"
                  defaultValue={current?.nombre ?? ""}
                  id={`beneficiario-${slot}-nombre`}
                  maxLength={160}
                  name={`beneficiario_${slot}_nombre`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`beneficiario-${slot}-parentesco`}>
                  Parentesco
                </Label>
                <Input
                  className="h-11"
                  defaultValue={current?.parentesco ?? ""}
                  id={`beneficiario-${slot}-parentesco`}
                  maxLength={60}
                  name={`beneficiario_${slot}_parentesco`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`beneficiario-${slot}-porcentaje`}>%</Label>
                <Input
                  className="h-11"
                  defaultValue={current ? String(current.porcentaje) : ""}
                  id={`beneficiario-${slot}-porcentaje`}
                  inputMode="decimal"
                  name={`beneficiario_${slot}_porcentaje`}
                />
              </div>
            </div>
          );
        })}
        {errors.beneficiarios ? (
          <p className="text-destructive text-sm" role="alert">
            {errors.beneficiarios}
          </p>
        ) : null}
      </fieldset>

      {state.error ? (
        <p className="text-destructive text-sm font-medium" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm font-medium" role="status">
          {state.notice}
        </p>
      ) : null}

      {editable ? (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            aria-busy={pending}
            className="min-h-11 sm:flex-1"
            disabled={pending}
            name="intencion"
            size="lg"
            type="submit"
            value="enviar"
          >
            Enviar a RH
          </Button>
          <Button
            className="min-h-11 sm:flex-1"
            disabled={pending}
            name="intencion"
            size="lg"
            type="submit"
            value="guardar"
            variant="secondary"
          >
            Guardar y seguir después
          </Button>
        </div>
      ) : null}
    </form>
  );
};
