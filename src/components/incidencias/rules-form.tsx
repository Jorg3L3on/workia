"use client";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INCIDENCIAS_COPY } from "@/lib/incidencias/copy";
import type { IncidenciaRules } from "@/lib/incidencias/rules";

import { useIncidenciaAction, type IncidenciaAction } from "./use-action";

const FIELDS = [
  {
    name: "retardoToleranceMinutes",
    label: INCIDENCIAS_COPY.retardoLabel,
    hint: INCIDENCIAS_COPY.retardoHint,
    required: true,
  },
  {
    name: "salidaToleranceMinutes",
    label: INCIDENCIAS_COPY.salidaLabel,
    hint: INCIDENCIAS_COPY.salidaHint,
    required: true,
  },
  {
    name: "faltaAfterMinutes",
    label: INCIDENCIAS_COPY.faltaAfterLabel,
    hint: INCIDENCIAS_COPY.faltaAfterHint,
    required: false,
  },
] as const;

/** The company's tolerances (W2-14). Saving applies from the next quincena. */
export const IncidenciaRulesForm = ({
  rules,
  action,
  disabled,
}: {
  rules: IncidenciaRules;
  action: IncidenciaAction;
  disabled: boolean;
}) => {
  const { pending, error, handleSubmit } = useIncidenciaAction(action);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      data-testid="incidencia-rules-form"
      onSubmit={handleSubmit}
    >
      <CompanyField />
      {FIELDS.map((field) => {
        const value = rules[field.name];

        return (
          <div className="flex flex-col gap-1.5" key={field.name}>
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              aria-describedby={`${field.name}-hint`}
              defaultValue={value === null ? "" : String(value)}
              disabled={disabled || pending}
              id={field.name}
              inputMode="numeric"
              max={field.name === "faltaAfterMinutes" ? 720 : 120}
              min={0}
              name={field.name}
              required={field.required}
              type="number"
            />
            <p
              className="text-muted-foreground text-sm"
              id={`${field.name}-hint`}
            >
              {field.hint}
            </p>
          </div>
        );
      })}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {disabled ? null : (
        <div>
          <Button
            aria-busy={pending}
            disabled={pending}
            type="submit"
            variant="primary"
          >
            {pending ? "Guardando…" : INCIDENCIAS_COPY.saveRules}
          </Button>
        </div>
      )}
    </form>
  );
};
